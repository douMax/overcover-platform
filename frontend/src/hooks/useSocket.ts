import { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { GameEvents, VoteWarningPayload } from "@shared/events";
import { Room, RoomConfig } from "@shared/types/room";
import { GameTypeEnum } from "@shared/types/enums";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "";

// Singleton state to persist across navigation
let globalSocket: Socket | null = null;
let globalRoom: Room | null = null;
let globalIsConnected = false;
const roomListeners = new Set<(room: Room | null) => void>();
const connectionListeners = new Set<(connected: boolean) => void>();
const voteWarningListeners = new Set<(warning: VoteWarningPayload) => void>();

// Persistence keys
const STORAGE_KEYS = {
  PLAYER_ID: "overcover_player_id",
  NICKNAME: "overcover_nickname",
  AVATAR: "overcover_avatar",
  LAST_ROOM_ID: "overcover_last_room_id",
};

function getOrCreatePlayerId(): string {
  let id = localStorage.getItem(STORAGE_KEYS.PLAYER_ID);
  if (!id) {
    id = Math.random().toString(36).substring(2, 15);
    localStorage.setItem(STORAGE_KEYS.PLAYER_ID, id);
  }
  return id;
}

function getOrCreateSocket(): Socket {
  if (!globalSocket || globalSocket.disconnected) {
    if (globalSocket) {
      globalSocket.removeAllListeners();
      globalSocket.close();
    }
    globalSocket = io(SOCKET_URL, {
      transports: ["websocket"],
    });

    globalSocket.on("connect", () => {
      console.log("Socket connected:", globalSocket?.id);
      globalIsConnected = true;
      connectionListeners.forEach(l => l(true));
    });

    globalSocket.on("disconnect", () => {
      console.log("Socket disconnected");
      globalIsConnected = false;
      connectionListeners.forEach(l => l(false));
    });

    globalSocket.on(GameEvents.UPDATE_ROOM_STATE, (roomState: Room) => {
      console.log("Received room state:", roomState.id);
      globalRoom = roomState;
      roomListeners.forEach(l => l(roomState));
    });

    globalSocket.on(GameEvents.PLAYER_KICKED, (data: { roomId: string; message: string }) => {
      console.log("Player kicked:", data.message);
      globalRoom = null;
      roomListeners.forEach(l => l(null));
    });

    globalSocket.on(GameEvents.VOTE_WARNING, (warning: VoteWarningPayload) => {
      voteWarningListeners.forEach(l => l(warning));
    });

    globalSocket.on("error", (error: { message: string }) => {
      console.error("Socket error:", error);
    });
  }
  return globalSocket;
}

export function useSocket() {
  const [socket, setSocket] = useState<Socket | null>(globalSocket);
  const [isConnected, setIsConnected] = useState(globalIsConnected);
  const [room, setRoom] = useState<Room | null>(globalRoom);
  const [playerId] = useState(() => getOrCreatePlayerId());
  const [voteWarning, setVoteWarning] = useState<VoteWarningPayload | null>(null);

  useEffect(() => {
    const newSocket = getOrCreateSocket();
    setSocket(newSocket);
    setIsConnected(newSocket.connected);

    roomListeners.add(setRoom);
    connectionListeners.add(setIsConnected);
    voteWarningListeners.add(setVoteWarning);

    return () => {
      roomListeners.delete(setRoom);
      connectionListeners.delete(setIsConnected);
      voteWarningListeners.delete(setVoteWarning);
    };
  }, []);

  const joinRoom = (
    roomId: string,
    nickname: string,
    isHost: boolean,
    gameType?: GameTypeEnum,
    avatar?: string
  ) => {
    const s = socket || getOrCreateSocket();
    if (!s) return;

    localStorage.setItem(STORAGE_KEYS.NICKNAME, nickname);
    if (avatar) localStorage.setItem(STORAGE_KEYS.AVATAR, avatar);
    localStorage.setItem(STORAGE_KEYS.LAST_ROOM_ID, roomId);

    s.emit(GameEvents.JOIN_ROOM, {
      roomId,
      nickname,
      isHost,
      gameType,
      avatar,
      playerId,
    });
  };

  const rejoin = (roomId: string) => {
    const nickname = localStorage.getItem(STORAGE_KEYS.NICKNAME);
    const avatar = localStorage.getItem(STORAGE_KEYS.AVATAR) || undefined;

    if (!nickname || !roomId) return false;

    const s = socket || getOrCreateSocket();
    console.log("Attempting auto-rejoin:", { roomId, nickname, playerId });

    s.emit(GameEvents.JOIN_ROOM, {
      roomId,
      nickname,
      isHost: false,
      avatar,
      playerId,
    });
    return true;
  };

  const startGame = (gameType: GameTypeEnum, config: RoomConfig) => {
    if (!socket || !room) return;
    socket.emit(GameEvents.START_GAME, { roomId: room.id, gameType, config });
  };

  const setReady = (roomId: string, isReady: boolean) => {
    if (!socket) return;
    socket.emit(GameEvents.PLAYER_READY, {
      roomId,
      playerId,
      isReady,
    });
  };

  const performGameAction = (action: string, data?: Record<string, unknown>) => {
    if (!socket || !room) return;
    socket.emit(GameEvents.GAME_ACTION, {
      roomId: room.id,
      action,
      data,
    });
  };

  const submitVote = (targetId: string) => {
    performGameAction("SUBMIT_VOTE", { targetId });
  };

  const revealVotes = (force = false) => {
    setVoteWarning(null);
    performGameAction("REVEAL_VOTES", force ? { force: true } : undefined);
  };

  const eliminatePlayer = (targetId: string) => {
    performGameAction("ELIMINATE_PLAYER", { targetId });
  };

  const nextRound = () => {
    performGameAction("NEXT_ROUND");
  };

  const skipEliminate = () => {
    performGameAction("SKIP_ELIMINATE");
  };

  const endGame = (winner?: string) => {
    performGameAction("END_GAME", winner ? { winner } : undefined);
  };

  const restartGame = () => {
    performGameAction("RESTART_GAME");
  };

  const updatePlayer = (roomId: string, updates: { nickname?: string; avatar?: string }) => {
    if (!socket) return;
    socket.emit(GameEvents.UPDATE_PLAYER, {
      roomId,
      playerId,
      ...updates,
    });
    // Also update localStorage
    if (updates.nickname) localStorage.setItem(STORAGE_KEYS.NICKNAME, updates.nickname);
    if (updates.avatar) localStorage.setItem(STORAGE_KEYS.AVATAR, updates.avatar);
  };

  const kickPlayer = (roomId: string, targetPlayerId: string) => {
    if (!socket) return;
    socket.emit(GameEvents.KICK_PLAYER, {
      roomId,
      targetPlayerId,
    });
  };

  const clearVoteWarning = () => setVoteWarning(null);

  return {
    socket,
    isConnected,
    room,
    playerId,
    voteWarning,
    joinRoom,
    rejoin,
    startGame,
    setReady,
    performGameAction,
    submitVote,
    revealVotes,
    eliminatePlayer,
    nextRound,
    skipEliminate,
    endGame,
    restartGame,
    updatePlayer,
    kickPlayer,
    clearVoteWarning,
  };
}
