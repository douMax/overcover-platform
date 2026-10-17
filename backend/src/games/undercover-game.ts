import { BaseGame } from "./base-game";
import { UndercoverGameState, UndercoverGameStateDTO } from "../../../shared/types/game-state";
import { Player, PlayerDTO, PlayerRole } from "../../../shared/types/player";
import { RoomStatus } from "../../../shared/types/enums";
import { loadWordPairs, WordPair } from "../utils/word-loader";
import { RoomConfig } from "../../../shared/types/room";
import { getContentStore } from "../content/content-store";
import { FeedbackTarget } from "./base-game";

export class UndercoverGame extends BaseGame {
  private wordPairs: WordPair[] = [];
  private hostIsPlaying = true;

  onStart(config: RoomConfig): void {
    this.wordPairs = loadWordPairs();
    this.hostIsPlaying = config.hostIsPlaying !== false; // default true

    // Filter by category if specified
    let availablePairs = this.wordPairs;
    if (config.wordCategory) {
      const filtered = this.wordPairs.filter(p => p.category === config.wordCategory);
      if (filtered.length > 0) availablePairs = filtered;
    }

    const wordPair = this.resolveCustomPair(config.customWordPairs?.[0]) ||
      availablePairs[Math.floor(Math.random() * availablePairs.length)];
    const numUndercovers = config.numUndercovers || 1;
    const spyWordMode = config.spyWordMode || 'same';

    // Set host playing status
    const host = this.room.players.find(p => p.isHost);
    if (host) {
      host.isPlaying = this.hostIsPlaying;
    }

    // Get players who are playing
    const playingPlayers = this.room.players.filter(p => p.isPlaying);

    // Fisher-Yates shuffle for unbiased randomization
    const shuffled = [...playingPlayers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const undercovers = shuffled.slice(0, numUndercovers);
    const civilians = shuffled.slice(numUndercovers);

    const assignedWords: Record<string, string> = {};
    const assignedRoles: Record<string, PlayerRole> = {};

    undercovers.forEach(player => {
      assignedWords[player.id] = spyWordMode === 'blank' ? '' : wordPair.B;
      assignedRoles[player.id] = PlayerRole.UNDERCOVER;
    });

    civilians.forEach(player => {
      assignedWords[player.id] = wordPair.A;
      assignedRoles[player.id] = PlayerRole.CIVILIAN;
    });

    // Update players
    playingPlayers.forEach(player => {
      player.role = assignedRoles[player.id];
      player.isAlive = true;
      player.gameData = {
        gameType: "UNDERCOVER",
        word: assignedWords[player.id],
      };
    });

    const roundRecordId = getContentStore().startRound({
      roomId: this.room.id,
      game: "UNDERCOVER",
      cardId: wordPair.id ?? null,
      mode: spyWordMode,
      playerCount: playingPlayers.length,
    });

    this.gameState = {
      type: "UNDERCOVER",
      wordPairs: [{ A: wordPair.A, B: wordPair.B, id: wordPair.id }],
      roundRecordId,
      assignedWords,
      assignedRoles,
      phase: "PLAYING",
      round: 1,
      votes: {},
      votedPlayerIds: [],
      revealedVotes: false,
      eliminatedPlayerIds: [],
    };

    this.room.status = RoomStatus.PLAYING;
  }

  onAction(action: string, data: any): void {
    if (!this.gameState || this.gameState.type !== "UNDERCOVER") return;
    const state = this.gameState as UndercoverGameState;

    switch (action) {
      case "SUBMIT_VOTE": {
        const { voterId, targetId } = data;
        // Validate: voter must be alive and playing, target must be alive and playing
        const voter = this.room.players.find(p => p.id === voterId);
        const target = this.room.players.find(p => p.id === targetId);
        if (!voter || !target) return;
        if (!voter.isAlive || !voter.isPlaying) return;
        if (!target.isAlive || !target.isPlaying) return;
        if (state.eliminatedPlayerIds.includes(voterId)) return;
        if (state.eliminatedPlayerIds.includes(targetId)) return;
        // Can't vote for yourself
        if (voterId === targetId) return;

        state.votes[voterId] = targetId;
        state.votedPlayerIds = Object.keys(state.votes);
        break;
      }

      case "REVEAL_VOTES": {
        state.revealedVotes = true;
        state.phase = "REVEAL";
        break;
      }

      case "ELIMINATE_PLAYER": {
        const { targetId } = data;
        const target = this.room.players.find(p => p.id === targetId);
        if (!target || !target.isAlive) return;

        state.eliminatedPlayerIds.push(targetId);
        target.isAlive = false;

        // Check win condition
        const winner = this.checkWinCondition();
        if (winner) {
          state.winner = winner;
        }
        break;
      }

      case "NEXT_ROUND":
      case "SKIP_ELIMINATE": {
        state.round += 1;
        state.votes = {};
        state.votedPlayerIds = [];
        state.revealedVotes = false;
        state.phase = "PLAYING";
        break;
      }

      case "END_GAME": {
        if (state.phase === "RESULT") return;
        if (data?.winner) {
          state.winner = data.winner;
        }
        state.phase = "RESULT";
        getContentStore().finishRound(state.roundRecordId, {
          winner: state.winner ?? null,
          rounds: state.round,
          eliminated: state.eliminatedPlayerIds.length,
          undercovers: Object.values(state.assignedRoles).filter(r => r === PlayerRole.UNDERCOVER).length,
        });
        break;
      }
    }
  }

  onEnd(): void {
    this.gameState = null;
    this.room.status = RoomStatus.WAITING;
    this.room.players.forEach(player => {
      player.role = undefined;
      player.gameData = undefined;
      player.isAlive = true;
    });
  }

  override getFeedbackTarget(): FeedbackTarget | null {
    if (!this.gameState || this.gameState.type !== "UNDERCOVER") return null;
    const state = this.gameState as UndercoverGameState;
    const cardId = state.wordPairs[0]?.id;
    if (state.phase !== "RESULT" || !state.roundRecordId || !cardId) return null;
    return { roundId: state.roundRecordId, cardId, game: "UNDERCOVER" };
  }

  /** Keep a host-supplied pair, but only trust its card id if it matches the bank */
  private resolveCustomPair(
    custom: { A: string; B: string; id?: string } | undefined
  ): { A: string; B: string; id?: string } | undefined {
    if (!custom) return undefined;
    const banked = this.wordPairs.find(p => p.id === custom.id);
    const matches = banked && banked.A === custom.A && banked.B === custom.B;
    return { A: custom.A, B: custom.B, id: matches ? custom.id : undefined };
  }

  /**
   * Check win condition:
   * - All spies eliminated → CIVILIAN wins
   * - Alive spies >= alive civilians → UNDERCOVER wins
   */
  private checkWinCondition(): 'CIVILIAN' | 'UNDERCOVER' | null {
    if (!this.gameState || this.gameState.type !== "UNDERCOVER") return null;
    const state = this.gameState as UndercoverGameState;

    const alivePlayers = this.room.players.filter(
      p => p.isPlaying && p.isAlive && !state.eliminatedPlayerIds.includes(p.id)
    );

    const aliveSpies = alivePlayers.filter(
      p => state.assignedRoles[p.id] === PlayerRole.UNDERCOVER
    );
    const aliveCivilians = alivePlayers.filter(
      p => state.assignedRoles[p.id] === PlayerRole.CIVILIAN
    );

    if (aliveSpies.length === 0) return 'CIVILIAN';
    if (aliveSpies.length >= aliveCivilians.length) return 'UNDERCOVER';
    return null;
  }

  /**
   * Returns info about unvoted players (for vote warning)
   */
  getVoteStatus(): { totalAlive: number; voted: number; notVoted: string[] } {
    if (!this.gameState || this.gameState.type !== "UNDERCOVER") {
      return { totalAlive: 0, voted: 0, notVoted: [] };
    }
    const state = this.gameState as UndercoverGameState;

    const alivePlaying = this.room.players.filter(
      p => p.isPlaying && p.isAlive && !state.eliminatedPlayerIds.includes(p.id)
    );
    const votedSet = new Set(state.votedPlayerIds);
    const notVoted = alivePlaying
      .filter(p => !votedSet.has(p.id))
      .map(p => p.id);

    return {
      totalAlive: alivePlaying.length,
      voted: votedSet.size,
      notVoted,
    };
  }

  /**
   * Sanitize game state per viewer
   */
  override sanitizeGameState(viewerId: string): UndercoverGameStateDTO | null {
    if (!this.gameState || this.gameState.type !== "UNDERCOVER") return null;
    const state = this.gameState as UndercoverGameState;

    const viewer = this.room.players.find(p => p.id === viewerId);
    if (!viewer) return null;

    const isHostViewing = viewer.isHost;
    const isNonPlayingHost = isHostViewing && !this.hostIsPlaying;
    const isRevealOrResult = state.phase === "REVEAL" || state.phase === "RESULT";

    const dto: UndercoverGameStateDTO = {
      type: "UNDERCOVER",
      phase: state.phase,
      round: state.round,
      votedPlayerIds: state.votedPlayerIds,
      eliminatedPlayerIds: state.eliminatedPlayerIds,
      winner: state.winner,
    };

    // Own word (playing players only)
    if (viewer.isPlaying && state.assignedWords[viewerId] !== undefined) {
      dto.myWord = state.assignedWords[viewerId];
    }

    // Own vote target
    if (state.votes[viewerId]) {
      dto.myVoteTarget = state.votes[viewerId];
    }

    // Show role only during RESULT phase (for playing players)
    if (state.phase === "RESULT" && viewer.isPlaying) {
      dto.myRole = state.assignedRoles[viewerId];
    }

    // Revealed votes: visible to everyone during REVEAL and RESULT
    if (isRevealOrResult) {
      dto.revealedVotes = { ...state.votes };
    }

    // Non-playing host gets god view
    if (isNonPlayingHost) {
      dto.allRoles = { ...state.assignedRoles };
      dto.allWords = { ...state.assignedWords };
      // Non-playing host always sees votes
      dto.revealedVotes = { ...state.votes };
    }

    // During RESULT, reveal all roles and words to everyone
    if (state.phase === "RESULT") {
      dto.allRoles = { ...state.assignedRoles };
      dto.allWords = { ...state.assignedWords };
    }
    dto.canRate = this.getFeedbackTarget() !== null;

    return dto;
  }

  /**
   * Override sanitization for player data
   */
  sanitizePlayerData(player: Player, viewerId?: string): PlayerDTO {
    const dto = super.sanitizePlayerData(player, viewerId);

    const isHostViewing = this.room.players.find(p => p.id === viewerId)?.isHost || false;
    const isNonPlayingHost = isHostViewing && !this.hostIsPlaying;
    const state = this.gameState as UndercoverGameState | null;
    const isResult = state?.phase === "RESULT";

    if (isNonPlayingHost || isResult) {
      // Non-playing host or RESULT phase: show everything
      return {
        ...dto,
        role: player.role,
        gameData: player.gameData,
      };
    }

    if (viewerId === player.id) {
      // Player viewing own data: show word but hide role
      return {
        ...dto,
        role: undefined,
      };
    }

    // Other players: hide everything
    return {
      ...dto,
      role: undefined,
      gameData: undefined,
    };
  }
}
