import { BaseGame } from "./base-game";
import { RoomStatus } from "../../../shared/types/enums";
import { RoomConfig } from "../../../shared/types/room";
import { Player, PlayerDTO } from "../../../shared/types/player";
import {
  BluffCard,
  BluffKingGameState,
  BluffKingGameStateDTO,
  BluffMode,
  BluffRole,
} from "../../../shared/types/game-state";
import { loadBluffCards } from "../utils/bluff-card-loader";
import { getContentStore } from "../content/content-store";
import { FeedbackTarget } from "./base-game";

const MAX_SPEAKERS = 5;
export const BLUFF_KING_MIN_PLAYERS = 4;
// Rounds can continue with 3 if someone leaves mid-game (1 honest, 1 bluffer, 1 guesser)
const MIN_PLAYERS_TO_CONTINUE = 3;

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Shuffle first so ties are broken randomly, then stable-sort by count */
function pickLeast(ids: string[], counts: Record<string, number>, n: number): string[] {
  return shuffle(ids)
    .sort((a, b) => (counts[a] || 0) - (counts[b] || 0))
    .slice(0, n);
}

/**
 * Bluff King (谁是瞎掰王)
 * One Honest player knows the real meaning of an obscure word, Bluffers only see
 * partial info, Guessers vote for who they think is the Honest one.
 */
export class BluffKingGame extends BaseGame {
  private cards: BluffCard[] = [];

  onStart(config: RoomConfig): void {
    const hostIsPlaying = config.hostIsPlaying !== false;
    const host = this.room.players.find(p => p.isHost);
    if (host) host.isPlaying = hostIsPlaying;

    const playingIds = this.room.players.filter(p => p.isPlaying).map(p => p.id);
    const totalRounds = Math.max(1, Math.min(30, config.bluffRounds || playingIds.length));

    this.gameState = {
      type: "BLUFF_KING",
      phase: "PLAYING",
      mode: config.bluffMode === "HINTS" ? "HINTS" : "HALF",
      hostIsPlaying,
      round: 0,
      totalRounds,
      card: this.drawCard([]),
      usedWords: [],
      roles: {},
      speakerOrder: [],
      bluffHints: {},
      honestLocked: false,
      votes: {},
      votedPlayerIds: [],
      scores: Object.fromEntries(playingIds.map(id => [id, 0])),
      roundGains: {},
      crownedIds: [],
      speakCounts: {},
      honestCounts: {},
    };

    this.room.players.forEach(p => {
      p.isAlive = true;
      p.role = undefined;
      p.gameData = undefined;
    });

    this.startRound();
    this.room.status = RoomStatus.PLAYING;
  }

  onAction(action: string, data: Record<string, unknown>): void {
    const state = this.state();
    if (!state) return;

    switch (action) {
      case "SUBMIT_VOTE": {
        if (state.phase !== "PLAYING") return;
        const voterId = data.voterId as string;
        const targetId = data.targetId as string;
        if (state.roles[voterId] !== "GUESSER") return;
        if (!state.speakerOrder.includes(targetId)) return;
        state.votes[voterId] = targetId;
        state.votedPlayerIds = Object.keys(state.votes);
        break;
      }

      case "HONEST_VIEW_EXPIRED": {
        if (state.roles[data.actorId as string] === "HONEST") {
          state.honestLocked = true;
        }
        break;
      }

      case "SKIP_CARD": {
        if (state.phase !== "PLAYING") return;
        getContentStore().markRoundSkipped(state.roundRecordId);
        state.usedWords.push(state.card.word);
        state.card = this.drawCard(state.usedWords);
        state.bluffHints = this.dealHints(state);
        state.honestLocked = false;
        state.votes = {};
        state.votedPlayerIds = [];
        state.roundRecordId = this.recordRoundStart(state);
        break;
      }

      case "REVEAL_VOTES": {
        if (state.phase !== "PLAYING") return;
        const outcome = this.scoreRound(state);
        getContentStore().finishRound(state.roundRecordId, outcome);
        state.phase = "REVEAL";
        break;
      }

      case "NEXT_ROUND": {
        if (state.phase !== "REVEAL") return;
        if (data.mode === "HALF" || data.mode === "HINTS") {
          state.mode = data.mode as BluffMode;
        }
        if (state.round >= state.totalRounds) {
          state.phase = "RESULT";
          return;
        }
        state.usedWords.push(state.card.word);
        state.card = this.drawCard(state.usedWords);
        this.startRound();
        break;
      }

      case "END_GAME": {
        state.phase = "RESULT";
        break;
      }
    }
  }

  onEnd(): void {
    this.gameState = null;
    this.room.status = RoomStatus.WAITING;
    this.room.players.forEach(p => {
      p.role = undefined;
      p.gameData = undefined;
      p.isAlive = true;
    });
  }

  /** Guessers who haven't voted yet (for the host's vote warning) */
  getVoteStatus(): { totalAlive: number; voted: number; notVoted: string[] } {
    const state = this.state();
    if (!state) return { totalAlive: 0, voted: 0, notVoted: [] };
    const guesserIds = this.presentIdsWithRole(state, "GUESSER");
    const notVoted = guesserIds.filter(id => !state.votes[id]);
    return {
      totalAlive: guesserIds.length,
      voted: guesserIds.length - notVoted.length,
      notVoted,
    };
  }

  override sanitizeGameState(viewerId: string): BluffKingGameStateDTO | null {
    const state = this.state();
    if (!state) return null;
    const viewer = this.room.players.find(p => p.id === viewerId);
    if (!viewer) return null;

    const role = state.roles[viewerId];
    const isGodView = viewer.isHost && !state.hostIsPlaying;
    const isRevealed = state.phase !== "PLAYING";

    const dto: BluffKingGameStateDTO = {
      type: "BLUFF_KING",
      phase: state.phase,
      mode: state.mode,
      round: state.round,
      totalRounds: state.totalRounds,
      word: state.card.word,
      reading: state.card.reading,
      category: state.card.category,
      speakerOrder: state.speakerOrder,
      guesserIds: this.presentIdsWithRole(state, "GUESSER"),
      votedPlayerIds: state.votedPlayerIds,
      scores: state.scores,
      myRole: role,
      myVoteTarget: state.votes[viewerId],
    };

    if (role === "HONEST") {
      dto.honestLocked = state.honestLocked;
      if (!state.honestLocked) dto.myExplanation = state.card.explanation;
    } else if (role === "BLUFFER") {
      if (state.mode === "HALF") dto.myFirstHalf = state.card.firstHalf;
      else dto.myHints = state.bluffHints[viewerId];
    }

    if (isRevealed || isGodView) {
      dto.honestId = state.speakerOrder.find(id => state.roles[id] === "HONEST");
      dto.explanation = state.card.explanation;
      dto.firstHalf = state.card.firstHalf;
      dto.trueHint = state.card.trueHint;
      dto.allHints = state.bluffHints;
      dto.revealedVotes = state.votes;
    }

    if (isRevealed) {
      dto.roundGains = state.roundGains;
      dto.crownedIds = state.crownedIds;
    }
    dto.canRate = this.getFeedbackTarget() !== null;

    return dto;
  }

  /** Roles live in the game state DTO; never expose gameData/role on players */
  override sanitizePlayerData(player: Player, viewerId?: string): PlayerDTO {
    return { ...super.sanitizePlayerData(player, viewerId), role: undefined, gameData: undefined };
  }

  override getFeedbackTarget(): FeedbackTarget | null {
    const state = this.state();
    if (!state || state.phase !== "REVEAL" || !state.roundRecordId) return null;
    return { roundId: state.roundRecordId, cardId: state.card.id, game: "BLUFF_KING" };
  }

  private recordRoundStart(state: BluffKingGameState): number | null {
    return getContentStore().startRound({
      roomId: this.room.id,
      game: "BLUFF_KING",
      cardId: state.card.id,
      roundNo: state.round,
      mode: state.mode,
      playerCount: Object.keys(state.roles).length,
      speakerCount: state.speakerOrder.length,
      guesserCount: Object.values(state.roles).filter(r => r === "GUESSER").length,
    });
  }

  private state(): BluffKingGameState | null {
    return this.gameState?.type === "BLUFF_KING" ? this.gameState : null;
  }

  private presentIdsWithRole(state: BluffKingGameState, role: BluffRole): string[] {
    return this.room.players
      .filter(p => state.roles[p.id] === role)
      .map(p => p.id);
  }

  private startRound(): void {
    const state = this.state();
    if (!state) return;

    const playingIds = this.room.players.filter(p => p.isPlaying).map(p => p.id);
    if (playingIds.length < MIN_PLAYERS_TO_CONTINUE) {
      state.phase = "RESULT";
      return;
    }

    const speakerCount = Math.min(playingIds.length - 1, MAX_SPEAKERS);
    const [honestId] = pickLeast(playingIds, state.honestCounts, 1);
    const bluffers = pickLeast(
      playingIds.filter(id => id !== honestId),
      state.speakCounts,
      speakerCount - 1
    );
    const speakers = [honestId, ...bluffers];

    state.roles = {};
    for (const id of playingIds) {
      state.roles[id] = id === honestId ? "HONEST" : bluffers.includes(id) ? "BLUFFER" : "GUESSER";
      if (state.scores[id] === undefined) state.scores[id] = 0;
    }
    for (const id of speakers) {
      state.speakCounts[id] = (state.speakCounts[id] || 0) + 1;
    }
    state.honestCounts[honestId] = (state.honestCounts[honestId] || 0) + 1;

    state.round += 1;
    state.phase = "PLAYING";
    state.speakerOrder = shuffle(speakers);
    state.bluffHints = this.dealHints(state);
    state.honestLocked = false;
    state.votes = {};
    state.votedPlayerIds = [];
    state.roundGains = {};
    state.crownedIds = [];
    state.roundRecordId = this.recordRoundStart(state);
  }

  /** Each bluffer gets the true hint plus 2 random decoys, shuffled */
  private dealHints(state: BluffKingGameState): Record<string, string[]> {
    const hints: Record<string, string[]> = {};
    for (const id of state.speakerOrder) {
      if (state.roles[id] !== "BLUFFER") continue;
      const decoys = shuffle(state.card.decoyHints).slice(0, 2);
      hints[id] = shuffle([state.card.trueHint, ...decoys]);
    }
    return hints;
  }

  private drawCard(usedWords: string[]): BluffCard {
    if (this.cards.length === 0) this.cards = loadBluffCards();
    let pool = this.cards.filter(c => !usedWords.includes(c.word));
    if (pool.length === 0) pool = this.cards;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * Correct guess: guesser +1 and honest +1.
   * Each vote a bluffer fools: that bluffer +1.
   */
  private scoreRound(state: BluffKingGameState): Record<string, unknown> {
    const gains: Record<string, number> = {};
    const add = (id: string) => {
      gains[id] = (gains[id] || 0) + 1;
      state.scores[id] = (state.scores[id] || 0) + 1;
    };

    const bluffVotes: Record<string, number> = {};
    for (const [voterId, targetId] of Object.entries(state.votes)) {
      if (state.roles[targetId] === "HONEST") {
        add(voterId);
        add(targetId);
      } else {
        add(targetId);
        bluffVotes[targetId] = (bluffVotes[targetId] || 0) + 1;
      }
    }

    const maxVotes = Math.max(0, ...Object.values(bluffVotes));
    state.crownedIds = maxVotes > 0
      ? Object.keys(bluffVotes).filter(id => bluffVotes[id] === maxVotes)
      : [];
    state.roundGains = gains;

    const totalVotes = Object.keys(state.votes).length;
    const bluffVoteTotal = Object.values(bluffVotes).reduce((a, b) => a + b, 0);
    return {
      totalVotes,
      correctVotes: totalVotes - bluffVoteTotal,
      bluffVotes: Object.values(bluffVotes).sort((a, b) => b - a),
      honestLocked: state.honestLocked,
    };
  }
}
