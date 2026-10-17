import express from "express";
import path from "path";
import { createServer } from "http";
import { setupSocketIO } from "./socket";
import { RoomManager } from "./room-manager";
import { loadWordPairs, getWordCategories } from "./utils/word-loader";
import { getTaskCategories } from "./utils/task-loader";
import { loadBluffCards } from "./utils/bluff-card-loader";
import { getContentStore, ContentGame } from "./content/content-store";
import { timingSafeEqual } from "crypto";
import { isFeatureEnabled } from "./config/features";
// State persistence is available in ./utils/state-persistence.ts
// Currently disabled — will be replaced with Redis for production.
// import { saveState, loadState } from "./utils/state-persistence";

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5050;

// Mirror the file-based card banks into the content store (no-op if it's unavailable)
const contentStore = getContentStore();
contentStore.syncCards("UNDERCOVER", loadWordPairs().map(p => ({
  id: p.id, title: `${p.A} / ${p.B}`, category: p.category, content: { A: p.A, B: p.B },
})));
contentStore.syncCards("BLUFF_KING", loadBluffCards().map(c => ({
  id: c.id, title: c.word, category: c.category, content: c,
})));

// Initialize room manager
const roomManager = new RoomManager();

// Setup Socket.io
const { io, handlers } = setupSocketIO(httpServer, roomManager);

// Graceful shutdown — close server to release port
function shutdown() {
  console.log("Shutting down...");
  httpServer.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Basic Express routes
app.use(express.json());

// CORS middleware (for development)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/word-pairs", (req, res) => {
  const pairs = loadWordPairs();
  res.json(pairs);
});

app.get("/api/word-categories", (req, res) => {
  const categories = getWordCategories();
  res.json(categories);
});

// Card bank stats — needs the contentService toggle and ADMIN_TOKEN; send "Authorization: Bearer <token>"
app.get("/api/v1/admin/stats", (req, res) => {
  if (!isFeatureEnabled("contentService")) return res.sendStatus(404);
  const token = process.env.ADMIN_TOKEN;
  const given = Buffer.from((req.header("authorization") || "").replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(token || "");
  const authorized = !!token && given.length === expected.length && timingSafeEqual(given, expected);
  if (!authorized) return res.sendStatus(token ? 401 : 404);

  const game = req.query.game === "UNDERCOVER" || req.query.game === "BLUFF_KING"
    ? (req.query.game as ContentGame) : undefined;
  res.json({ available: contentStore.isAvailable, cards: contentStore.getStats(game) });
});

app.get("/api/task-categories", (req, res) => {
  const categories = getTaskCategories();
  res.json(categories);
});

app.get("/api/rooms", async (req, res) => {
  const roomIds = await roomManager.getAllRoomIds();
  const rooms = [];
  for (const id of roomIds) {
    const room = await roomManager.getRoom(id);
    if (!room) continue;
    const game = handlers.getGame(id);
    const gameState = game?.getGameState();
    rooms.push({
      id: room.id,
      status: room.status,
      gameType: room.gameType,
      playerCount: room.players.length,
      connectedCount: room.players.filter(p => p.isConnected).length,
      players: room.players.map(p => ({
        nickname: p.nickname,
        isHost: p.isHost,
        isConnected: p.isConnected,
        isAlive: p.isAlive,
      })),
      gamePhase: gameState && 'phase' in gameState ? gameState.phase : null,
      createdBy: room.players.find(p => p.isHost)?.nickname || "unknown",
    });
  }
  res.json(rooms);
});

// Serve frontend static files in production
const frontendDist = path.join(__dirname, "../../frontend/dist");
app.use(express.static(frontendDist));

// SPA fallback — serve index.html for all non-API routes
app.get("*", (req, res) => {
  res.sendFile(path.join(frontendDist, "index.html"));
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`Overcover server running on port ${PORT}`);
  console.log(`Serving frontend from ${frontendDist}`);
});

// Exported for testing only
export { httpServer, io, roomManager };
