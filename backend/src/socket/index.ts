import { Server as SocketIOServer } from "socket.io";
import { Server as HTTPServer } from "http";
import { RoomManager } from "../room-manager";
import { SocketHandlers } from "./handlers";
import { GameEvents } from "../../../shared/events";

export function setupSocketIO(
  httpServer: HTTPServer,
  roomManager: RoomManager
): { io: SocketIOServer; handlers: SocketHandlers } {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  const handlers = new SocketHandlers(roomManager);

  io.on("connection", socket => {
    console.log(`Client connected: ${socket.id}`);

    socket.on(GameEvents.JOIN_ROOM, async payload => {
      await handlers.handleJoinRoom(socket, payload);

      let roomId = payload.roomId;
      if (payload.isHost) {
        const room = await roomManager.findRoomBySocketId(socket.id);
        roomId = room?.id || null;
      }

      if (roomId) {
        await broadcastRoomState(io, roomId, handlers, roomManager);
      }
    });

    socket.on(GameEvents.START_GAME, async payload => {
      await handlers.handleStartGame(socket, payload);
      if (payload.roomId) {
        await broadcastRoomState(io, payload.roomId, handlers, roomManager);
      }
    });

    socket.on(GameEvents.PLAYER_READY, async payload => {
      await handlers.handlePlayerReady(socket, payload);
      if (payload.roomId) {
        await broadcastRoomState(io, payload.roomId, handlers, roomManager);
      }
    });

    socket.on(GameEvents.GAME_ACTION, async payload => {
      await handlers.handleGameAction(socket, payload, io);
    });

    socket.on(GameEvents.UPDATE_PLAYER, async payload => {
      await handlers.handleUpdatePlayer(socket, payload);
      if (payload.roomId) {
        await broadcastRoomState(io, payload.roomId, handlers, roomManager);
      }
    });

    socket.on(GameEvents.SUBMIT_FEEDBACK, async (payload, ack?: (ok: boolean) => void) => {
      const ok = await handlers.handleSubmitFeedback(socket, payload);
      if (typeof ack === "function") ack(ok);
    });

    socket.on(GameEvents.KICK_PLAYER, async payload => {
      await handlers.handleKickPlayer(socket, payload, io);
    });

    socket.on("disconnect", async () => {
      const room = await roomManager.findRoomBySocketId(socket.id);
      const affectedRoomId = room?.id || null;

      handlers.handleDisconnect(socket);

      if (affectedRoomId) {
        await broadcastRoomState(io, affectedRoomId, handlers, roomManager);
      }
    });
  });

  return { io, handlers };
}

async function broadcastRoomState(
  io: SocketIOServer,
  roomId: string,
  handlers: SocketHandlers,
  roomManager: RoomManager
): Promise<void> {
  const room = await roomManager.getRoom(roomId);
  if (!room) return;

  const game = handlers.getGame(roomId);

  room.players.forEach(player => {
    const sanitizedRoom = handlers.getSanitizedRoom(room, player.id, game);
    io.to(player.socketId).emit(GameEvents.UPDATE_ROOM_STATE, sanitizedRoom);
  });
}
