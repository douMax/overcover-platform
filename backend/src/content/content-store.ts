import { mkdirSync } from "fs";
import { dirname, join } from "path";
import type { DatabaseSync } from "node:sqlite";
import { FeedbackReason } from "../../../shared/events";
import { isFeatureEnabled } from "../config/features";

/**
 * Card bank usage data (rounds played, player feedback) backed by SQLite.
 *
 * The game must never depend on this: if the feature toggle is off, the
 * database can't be opened, or a write fails, every method is a no-op.
 */

const SCHEMA_VERSION = 1;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  id            TEXT PRIMARY KEY,
  game          TEXT NOT NULL,
  title         TEXT NOT NULL,
  category      TEXT,
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  first_seen_at TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id       TEXT NOT NULL,
  game          TEXT NOT NULL,
  card_id       TEXT,
  round_no      INTEGER,
  mode          TEXT,
  player_count  INTEGER,
  speaker_count INTEGER,
  guesser_count INTEGER,
  skipped       INTEGER NOT NULL DEFAULT 0,
  outcome       TEXT,
  created_at    TEXT NOT NULL,
  ended_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_rounds_card ON rounds(card_id);

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id   INTEGER NOT NULL,
  card_id    TEXT NOT NULL,
  game       TEXT NOT NULL,
  room_id    TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  rating     INTEGER NOT NULL,
  reasons    TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (round_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_card ON feedback(card_id);
`;

export type ContentGame = "UNDERCOVER" | "BLUFF_KING";

export interface CardRecord {
  id: string;
  title: string;
  category?: string;
  content: unknown;
}

export interface RoundStart {
  roomId: string;
  game: ContentGame;
  cardId: string | null;
  roundNo?: number;
  mode?: string;
  playerCount: number;
  speakerCount?: number;
  guesserCount?: number;
}

export interface FeedbackRecord {
  roundId: number;
  cardId: string;
  game: ContentGame;
  roomId: string;
  playerId: string;
  rating: 1 | -1;
  reasons?: FeedbackReason[];
}

export interface CardStats {
  id: string;
  game: string;
  title: string;
  category: string | null;
  status: string;
  plays: number;
  completed: number;
  skips: number;
  up: number;
  down: number;
  /** Wilson lower bound of the 👍 share (95%); null without feedback */
  approval: number | null;
  /** UNDERCOVER: spy win rate; BLUFF_KING: share of votes that found the honest player */
  balance: number | null;
}

const FEEDBACK_REASONS: FeedbackReason[] = ["too_hard", "too_easy", "never_heard", "funny", "boring"];

const now = () => new Date().toISOString();

export function wilsonLowerBound(up: number, total: number, z = 1.96): number | null {
  if (total === 0) return null;
  const p = up / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return (centre - margin) / denom;
}

export class ContentStore {
  private constructor(private db: DatabaseSync | null) {}

  static open(path: string): ContentStore {
    try {
      if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
      // Loaded lazily so a disabled store never pulls in node:sqlite
      const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
      const db = new DatabaseSync(path);
      db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 2000;");
      db.exec(SCHEMA);
      db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      console.log(`Content store ready: ${path}`);
      return new ContentStore(db);
    } catch (e) {
      console.error("Content store unavailable, continuing without it:", e);
      return new ContentStore(null);
    }
  }

  /** A store that does nothing (feature toggle off) */
  static disabled(): ContentStore {
    return new ContentStore(null);
  }

  get isAvailable(): boolean {
    return this.db !== null;
  }

  /** Mirror the file-based card bank: upsert present cards, retire missing ones */
  syncCards(game: ContentGame, cards: CardRecord[]): void {
    this.safely("syncCards", db => {
      const ts = now();
      const upsert = db.prepare(`
        INSERT INTO cards (id, game, title, category, content, status, first_seen_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          category = excluded.category,
          content = excluded.content,
          status = 'active',
          updated_at = CASE
            WHEN cards.content != excluded.content OR cards.status != 'active' THEN excluded.updated_at
            ELSE cards.updated_at
          END
      `);
      db.exec("BEGIN");
      try {
        for (const card of cards) {
          upsert.run(card.id, game, card.title, card.category ?? null, JSON.stringify(card.content), ts, ts);
        }
        const ids = cards.map(c => c.id);
        const placeholders = ids.map(() => "?").join(",") || "''";
        db.prepare(`UPDATE cards SET status = 'retired', updated_at = ? WHERE game = ? AND status != 'retired' AND id NOT IN (${placeholders})`)
          .run(ts, game, ...ids);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    });
  }

  /** Returns the round row id, or null if the store is unavailable */
  startRound(r: RoundStart): number | null {
    return this.safely("startRound", db => {
      const result = db.prepare(`
        INSERT INTO rounds (room_id, game, card_id, round_no, mode, player_count, speaker_count, guesser_count, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        r.roomId, r.game, r.cardId, r.roundNo ?? null, r.mode ?? null,
        r.playerCount, r.speakerCount ?? null, r.guesserCount ?? null, now()
      );
      return Number(result.lastInsertRowid);
    }) ?? null;
  }

  markRoundSkipped(roundId: number | null | undefined): void {
    if (!roundId) return;
    this.safely("markRoundSkipped", db => {
      db.prepare("UPDATE rounds SET skipped = 1, ended_at = ? WHERE id = ?").run(now(), roundId);
    });
  }

  finishRound(roundId: number | null | undefined, outcome: Record<string, unknown>): void {
    if (!roundId) return;
    this.safely("finishRound", db => {
      db.prepare("UPDATE rounds SET outcome = ?, ended_at = ? WHERE id = ?")
        .run(JSON.stringify(outcome), now(), roundId);
    });
  }

  /** One rating per player per round; a later rating replaces the earlier one */
  recordFeedback(f: FeedbackRecord): void {
    const reasons = (f.reasons ?? []).filter(r => FEEDBACK_REASONS.includes(r));
    this.safely("recordFeedback", db => {
      db.prepare(`
        INSERT INTO feedback (round_id, card_id, game, room_id, player_id, rating, reasons, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(round_id, player_id) DO UPDATE SET
          rating = excluded.rating, reasons = excluded.reasons, created_at = excluded.created_at
      `).run(f.roundId, f.cardId, f.game, f.roomId, f.playerId, f.rating, JSON.stringify(reasons), now());
    });
  }

  getStats(game?: ContentGame): CardStats[] {
    return this.safely("getStats", db => {
      const rows = db.prepare(`
        SELECT
          c.id, c.game, c.title, c.category, c.status,
          (SELECT COUNT(*) FROM rounds r WHERE r.card_id = c.id) AS plays,
          (SELECT COUNT(*) FROM rounds r WHERE r.card_id = c.id AND r.outcome IS NOT NULL) AS completed,
          (SELECT COUNT(*) FROM rounds r WHERE r.card_id = c.id AND r.skipped = 1) AS skips,
          (SELECT COUNT(*) FROM feedback f WHERE f.card_id = c.id AND f.rating = 1) AS up,
          (SELECT COUNT(*) FROM feedback f WHERE f.card_id = c.id AND f.rating = -1) AS down,
          (SELECT AVG(CASE json_extract(r.outcome, '$.winner') WHEN 'UNDERCOVER' THEN 1.0 ELSE 0.0 END)
             FROM rounds r WHERE r.card_id = c.id AND json_extract(r.outcome, '$.winner') IS NOT NULL) AS spy_win_rate,
          (SELECT CAST(SUM(json_extract(r.outcome, '$.correctVotes')) AS REAL) / NULLIF(SUM(json_extract(r.outcome, '$.totalVotes')), 0)
             FROM rounds r WHERE r.card_id = c.id AND r.outcome IS NOT NULL) AS guess_rate
        FROM cards c
        WHERE (? IS NULL OR c.game = ?)
        ORDER BY plays DESC, c.id
      `).all(game ?? null, game ?? null) as Array<Record<string, unknown>>;

      return rows.map(row => {
        const up = Number(row.up);
        const down = Number(row.down);
        const balance = row.game === "UNDERCOVER" ? row.spy_win_rate : row.guess_rate;
        return {
          id: String(row.id),
          game: String(row.game),
          title: String(row.title),
          category: row.category === null ? null : String(row.category),
          status: String(row.status),
          plays: Number(row.plays),
          completed: Number(row.completed),
          skips: Number(row.skips),
          up,
          down,
          approval: wilsonLowerBound(up, up + down),
          balance: balance === null || balance === undefined ? null : Number(balance),
        };
      });
    }) ?? [];
  }

  close(): void {
    this.safely("close", db => db.close());
    this.db = null;
  }

  private safely<T>(op: string, fn: (db: DatabaseSync) => T): T | undefined {
    if (!this.db) return undefined;
    try {
      return fn(this.db);
    } catch (e) {
      console.error(`Content store ${op} failed:`, e);
      return undefined;
    }
  }
}

let store: ContentStore | null = null;

/**
 * Process-wide store; DATA_DIR overrides the location (Fly volume mounts at /data).
 * Gated by the `contentService` feature toggle in config/features.ts.
 */
export function getContentStore(): ContentStore {
  if (!store && !isFeatureEnabled("contentService")) {
    console.log("Content service disabled by feature toggle; using static card files only");
    store = ContentStore.disabled();
  }
  if (!store) {
    const dataDir = process.env.DATA_DIR || join(__dirname, "../../data");
    store = ContentStore.open(process.env.CONTENT_DB === ":memory:" ? ":memory:" : join(dataDir, "overcover.db"));
  }
  return store;
}
