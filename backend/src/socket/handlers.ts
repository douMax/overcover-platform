import { Socket } from "socket.io";
import { Server as SocketIOServer } from "socket.io";
import { RoomManager } from "../room-manager";
import {
  GameEvents,
  JoinRoomPayload,
  StartGamePayload,
  PlayerReadyPayload,
  KickPlayerPayload,
  GameActionPayload,
  UpdatePlayerPayload,
  VoteWarningPayload,
  SubmitFeedbackPayload,
} from "../../../shared/events";
import { getContentStore } from "../content/content-store";
import { Room } from "../../../shared/types/room";
import { GameState } from "../../../shared/types/game-state";
import { Player } from "../../../shared/types/player";
import { PlayerDTO } from "../../../shared/types/player";
import { GameTypeEnum, RoomStatus } from "../../../shared/types/enums";
import { BaseGame } from "../games/base-game";
import { UndercoverGame } from "../games/undercover-game";
import { TaskWolfGame } from "../games/taskwolf-game";
import { ColourHuntGame } from "../games/colour-hunt-game";
import { BluffKingGame, BLUFF_KING_MIN_PLAYERS } from "../games/bluff-king-game";

type GameWithVoteStatus = UndercoverGame | TaskWolfGame | BluffKingGame;
import { sanitizePlayer } from "../utils/player-sanitizer";

export class SocketHandlers {
  private roomManager: RoomManager;
  private activeGames: Map<string, BaseGame> = new Map();

  constructor(roomManager: RoomManager) {
    this.roomManager = roomManager;
  }

  async handleJoinRoom(
    socket: Socket,
    payload: JoinRoomPayload
  ): Promise<void> {
    const { roomId, nickname, isHost, gameType, avatar, playerId } = payload;

    if (isHost) {
      const finalHostId = playerId || socket.id;
      const room = await this.roomManager.createRoom(
        finalHostId,
        nickname,
        socket.id,
        avatar
      );
      if (gameType) {
        await this.roomManager.updateRoomGameType(room.id, gameType as any);
        room.gameType = gameType as any;
      }
      socket.join(room.id);
      socket.emit(
        GameEvents.UPDATE_ROOM_STATE,
        this.getSanitizedRoom(room, finalHostId)
      );
    } else {
      const room = await this.roomManager.getRoom(roomId);
      if (!room) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      const finalPlayerId = playerId || socket.id;

      // Remove player from any previous room before joining a new one
      const previousRoom = await this.roomManager.findRoomByPlayerId(finalPlayerId);
      if (previousRoom && previousRoom.id !== roomId) {
        await this.roomManager.removePlayer(previousRoom.id, finalPlayerId);
        socket.leave(previousRoom.id);
      }

      const player: Player = {
        id: finalPlayerId,
        socketId: socket.id,
        nickname,
        avatar,
        isAlive: true,
        isHost: false,
        isPlaying: true,
        isReady: false,
        isConnected: true,
      };

      await this.roomManager.addPlayer(roomId, player);
      socket.join(roomId);

      await this.broadcastRoomState(roomId);
    }
  }

  async handleStartGame(
    socket: Socket,
    payload: StartGamePayload
  ): Promise<void> {
    const room = await this.roomManager.getRoom(payload.roomId || "");
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player || !player.isHost) {
      socket.emit("error", { message: "Only host can start the game" });
      return;
    }

    const allPlayersReady = room.players
      .filter(p => !p.isHost && p.isPlaying && p.isAlive)
      .every(p => p.isReady);
    if (!allPlayersReady) {
      socket.emit("error", { message: "仍有玩家未准备" });
      return;
    }

    let game: BaseGame;
    if (payload.gameType === GameTypeEnum.UNDERCOVER) {
      game = new UndercoverGame(room);
      game.onStart(payload.config || {});
    } else if (payload.gameType === GameTypeEnum.TASKWOLF) {
      game = new TaskWolfGame(room);
      game.onStart(payload.config || {});
    } else if (payload.gameType === GameTypeEnum.COLOUR_HUNT) {
      game = new ColourHuntGame(room);
      game.onStart(payload.config || {});
    } else if (payload.gameType === GameTypeEnum.BLUFF_KING) {
      const hostIsPlaying = payload.config?.hostIsPlaying !== false;
      const playingCount = room.players.filter(p => p.isHost ? hostIsPlaying : p.isPlaying).length;
      if (playingCount < BLUFF_KING_MIN_PLAYERS) {
        socket.emit("error", { message: `至少需要 ${BLUFF_KING_MIN_PLAYERS} 名玩家` });
        return;
      }
      game = new BluffKingGame(room);
      game.onStart(payload.config || {});
    } else {
      socket.emit("error", { message: "Invalid game type" });
      return;
    }

    this.activeGames.set(room.id, game);
    await this.roomManager.updateRoomGameType(room.id, payload.gameType);

    await this.broadcastRoomState(room.id);
  }

  /**
   * Handles game actions (vote, reveal, eliminate, next round, end game)
   */
  async handleGameAction(
    socket: Socket,
    payload: GameActionPayload,
    io: SocketIOServer
  ): Promise<void> {
    const room = await this.roomManager.getRoom(payload.roomId);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    const game = this.activeGames.get(payload.roomId);
    if (!game) {
      socket.emit("error", { message: "No active game" });
      return;
    }

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) {
      socket.emit("error", { message: "Player not in room" });
      return;
    }

    const hostOnlyActions = ["REVEAL_VOTES", "ELIMINATE_PLAYER", "NEXT_ROUND", "SKIP_ELIMINATE", "END_GAME", "RESTART_GAME", "REVEAL_ALL", "SKIP_CARD"];

    if (hostOnlyActions.includes(payload.action) && !player.isHost) {
      socket.emit("error", { message: "Only host can perform this action" });
      return;
    }

    // Inject the authenticated player as the actor (and voterId for SUBMIT_VOTE)
    payload.data = { ...payload.data, actorId: player.id };
    if (payload.action === "SUBMIT_VOTE") {
      payload.data.voterId = player.id;
    }

    // For REVEAL_VOTES, check if all players voted and warn if not
    if (payload.action === "REVEAL_VOTES" && (game instanceof UndercoverGame || game instanceof TaskWolfGame || game instanceof BluffKingGame)) {
      const voteStatus = (game as GameWithVoteStatus).getVoteStatus();
      if (voteStatus.notVoted.length > 0) {
        // Send warning to host — they can re-send REVEAL_VOTES with force flag
        if (!payload.data?.force) {
          const warning: VoteWarningPayload = {
            totalAlive: voteStatus.totalAlive,
            voted: voteStatus.voted,
            notVoted: voteStatus.notVoted,
          };
          socket.emit(GameEvents.VOTE_WARNING, warning);
          return;
        }
      }
    }

    // RESTART_GAME: reset to lobby
    if (payload.action === "RESTART_GAME") {
      game.onEnd();
      this.activeGames.delete(payload.roomId);
      // Reset all players' ready state
      room.players.forEach(p => {
        p.isReady = p.isHost ? true : false;
      });
      await this.broadcastRoomStateViaIO(io, payload.roomId);
      return;
    }

    game.onAction(payload.action, payload.data || {});

    // Broadcast updated state to all players
    await this.broadcastRoomStateViaIO(io, payload.roomId);
  }

  /** Store a player's 👍/👎 for the card currently revealed in their room */
  async handleSubmitFeedback(socket: Socket, payload: SubmitFeedbackPayload): Promise<boolean> {
    if (payload?.rating !== 1 && payload?.rating !== -1) return false;
    const room = await this.roomManager.getRoom(payload.roomId);
    const player = room?.players.find(p => p.socketId === socket.id);
    const target = this.activeGames.get(payload.roomId)?.getFeedbackTarget();
    if (!room || !player || !target) return false;

    getContentStore().recordFeedback({
      ...target,
      roomId: room.id,
      playerId: player.id,
      rating: payload.rating,
      reasons: Array.isArray(payload.reasons) ? payload.reasons : [],
    });
    return true;
  }

  async handleUpdatePlayer(
    socket: Socket,
    payload: UpdatePlayerPayload
  ): Promise<void> {
    const room = await this.roomManager.getRoom(payload.roomId);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    const player = room.players.find(p => p.id === payload.playerId && p.socketId === socket.id);
    if (!player) {
      socket.emit("error", { message: "Player not found" });
      return;
    }

    if (payload.nickname) player.nickname = payload.nickname;
    if (payload.avatar) player.avatar = payload.avatar;
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    console.log(`Client disconnected: ${socket.id}`);
    const room = await this.roomManager.findRoomBySocketId(socket.id);
    if (room) {
      const player = room.players.find(p => p.socketId === socket.id);
      if (player) {
        player.isConnected = false;
      }
    }
  }

  async handlePlayerReady(
    socket: Socket,
    payload: PlayerReadyPayload
  ): Promise<void> {
    const room = await this.roomManager.getRoom(payload.roomId);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    const player = room.players.find(p => p.socketId === socket.id);
    if (!player) {
      socket.emit("error", { message: "Player not in room" });
      return;
    }

    player.isReady = payload.isReady;
    await this.broadcastRoomState(payload.roomId);
  }

  async handleKickPlayer(
    socket: Socket,
    payload: KickPlayerPayload,
    io: SocketIOServer
  ): Promise<void> {
    const room = await this.roomManager.getRoom(payload.roomId);
    if (!room) {
      socket.emit("error", { message: "Room not found" });
      return;
    }

    const requester = room.players.find(p => p.socketId === socket.id);
    if (!requester || !requester.isHost) {
      socket.emit("error", { message: "Only host can kick players" });
      return;
    }

    const targetPlayer = room.players.find(p => p.id === payload.targetPlayerId);
    if (!targetPlayer) {
      socket.emit("error", { message: "Player not found" });
      return;
    }

    if (targetPlayer.isHost) {
      socket.emit("error", { message: "Cannot kick host" });
      return;
    }

    await this.roomManager.removePlayer(payload.roomId, payload.targetPlayerId);

    const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
    if (targetSocket) {
      targetSocket.emit(GameEvents.PLAYER_KICKED, {
        roomId: payload.roomId,
        message: "你已被房主移出房间",
      });
      targetSocket.leave(payload.roomId);
      targetSocket.disconnect(true);
    }

    await this.broadcastRoomStateViaIO(io, payload.roomId);
  }

  private async broadcastRoomState(roomId: string): Promise<void> {
    // Note: actual broadcasting happens in socket/index.ts via broadcastRoomState
  }

  /**
   * Broadcasts room state via io instance directly
   */
  async broadcastRoomStateViaIO(io: SocketIOServer, roomId: string): Promise<void> {
    const room = await this.roomManager.getRoom(roomId);
    if (!room) return;

    const game = this.activeGames.get(roomId);

    room.players.forEach(player => {
      const sanitizedRoom = this.getSanitizedRoom(room, player.id, game);
      io.to(player.socketId).emit(GameEvents.UPDATE_ROOM_STATE, sanitizedRoom);
    });
  }

  getSanitizedRoom(room: Room, viewerId: string, game?: BaseGame): Room {
    const sanitizedPlayers: PlayerDTO[] = room.players.map(player => {
      if (game) {
        return game.sanitizePlayerData(player, viewerId);
      }
      return sanitizePlayer(player, viewerId);
    });

    const sanitizedGameState = game ? game.sanitizeGameState(viewerId) : undefined;

    return {
      ...room,
      players: sanitizedPlayers as any,
      gameState: sanitizedGameState,
    };
  }

  getGame(roomId: string): BaseGame | undefined {
    return this.activeGames.get(roomId);
  }

  /** Export all game states for persistence */
  getGameStatesMap(): Map<string, GameState> {
    const states = new Map<string, GameState>();
    for (const [roomId, game] of this.activeGames) {
      const state = game.getGameState();
      if (state) states.set(roomId, state);
    }
    return states;
  }

  /** Restore game instances from persisted state */
  async restoreGames(
    gameStates: Map<string, GameState>
  ): Promise<void> {
    for (const [roomId, state] of gameStates) {
      if (!state) continue;
      const room = await this.roomManager.getRoom(roomId);
      if (!room) continue;

      let game: BaseGame;
      if (state.type === "UNDERCOVER") {
        game = new UndercoverGame(room);
      } else if (state.type === "TASKWOLF") {
        game = new TaskWolfGame(room);
      } else if (state.type === "COLOUR_HUNT") {
        game = new ColourHuntGame(room);
      } else if (state.type === "BLUFF_KING") {
        game = new BluffKingGame(room);
      } else {
        continue;
      }

      // Inject the persisted state directly
      (game as any).gameState = state;
      if (state.type === "UNDERCOVER") {
        (game as any).hostIsPlaying = room.players.some(
          p => p.isHost && p.isPlaying
        );
      }
      this.activeGames.set(roomId, game);
    }
    console.log(`Restored ${this.activeGames.size} active games`);
  }
}
