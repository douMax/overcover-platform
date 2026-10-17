import { Room, RoomConfig } from "./types/room";
import { GameTypeEnum } from "./types/enums";

export const GameEvents = {
  JOIN_ROOM: "join_room",
  UPDATE_ROOM_STATE: "update_room_state",
  START_GAME: "start_game",
  SET_PLAYER_STATUS: "set_player_status",
  PLAYER_READY: "player_ready",
  GAME_ACTION: "game_action",
  VOTE_WARNING: "vote_warning",
  UPDATE_PLAYER: "update_player",
  KICK_PLAYER: "kick_player",
  PLAYER_KICKED: "player_kicked",
  SUBMIT_FEEDBACK: "submit_feedback",
} as const;

export interface JoinRoomPayload {
  roomId: string;
  nickname: string;
  isHost: boolean;
  playerId?: string;
  avatar?: string;
  gameType?: GameTypeEnum;
}

export interface UpdateRoomStatePayload {
  roomId: string;
  state: Room;
}

export interface StartGamePayload {
  roomId: string;
  gameType: GameTypeEnum;
  config: RoomConfig;
}

export interface SetPlayerStatusPayload {
  targetId: string;
  status: "alive" | "dead";
}

export interface PlayerReadyPayload {
  roomId: string;
  playerId: string;
  isReady: boolean;
}

export interface GameActionPayload {
  roomId: string;
  action: string;
  data?: Record<string, unknown>;
}

export interface UpdatePlayerPayload {
  roomId: string;
  playerId: string;
  nickname?: string;
  avatar?: string;
}

export interface KickPlayerPayload {
  roomId: string;
  targetPlayerId: string;
}

export type FeedbackReason = "too_hard" | "too_easy" | "never_heard" | "funny" | "boring";

/** Player's rating of the card just revealed; the server resolves which card/round it was */
export interface SubmitFeedbackPayload {
  roomId: string;
  rating: 1 | -1;
  reasons?: FeedbackReason[];
}

export interface VoteWarningPayload {
  totalAlive: number;
  voted: number;
  notVoted: string[]; // player IDs who haven't voted
}
