import { PlayerRole } from './player';

export interface UndercoverGameState {
  type: 'UNDERCOVER';
  wordPairs: Array<{ A: string; B: string }>;
  assignedWords: Record<string, string>;
  assignedRoles: Record<string, PlayerRole>;
  phase: 'PLAYING' | 'REVEAL' | 'RESULT';
  round: number;
  votes: Record<string, string>;
  votedPlayerIds: string[];
  revealedVotes: boolean;
  eliminatedPlayerIds: string[];
  winner?: 'CIVILIAN' | 'UNDERCOVER';
}

export interface UndercoverGameStateDTO {
  type: 'UNDERCOVER';
  phase: 'PLAYING' | 'REVEAL' | 'RESULT';
  round: number;
  myWord?: string;
  myRole?: PlayerRole;
  votedPlayerIds: string[];
  myVoteTarget?: string;
  revealedVotes?: Record<string, string>;
  eliminatedPlayerIds: string[];
  winner?: 'CIVILIAN' | 'UNDERCOVER';
  allRoles?: Record<string, PlayerRole>;
  allWords?: Record<string, string>;
}

export interface TaskWolfGameState {
  type: 'TASKWOLF';
  assignedRoles: Record<string, PlayerRole>;
  wolfTasks: Record<string, string>;   // wolfId → task description
  phase: 'PLAYING' | 'REVEAL' | 'RESULT';
  round: number;
  votes: Record<string, string>;
  votedPlayerIds: string[];
  revealedVotes: boolean;
  eliminatedPlayerIds: string[];
  winner?: 'VILLAGER' | 'WOLF';
}

export interface TaskWolfGameStateDTO {
  type: 'TASKWOLF';
  phase: 'PLAYING' | 'REVEAL' | 'RESULT';
  round: number;
  myRole?: PlayerRole;
  myTask?: string;              // wolf only
  votedPlayerIds: string[];
  myVoteTarget?: string;
  revealedVotes?: Record<string, string>;
  eliminatedPlayerIds: string[];
  winner?: 'VILLAGER' | 'WOLF';
  // Host (always god view):
  allRoles?: Record<string, PlayerRole>;
  allTasks?: Record<string, string>;
}

export interface ColourHuntGameState {
  type: 'COLOUR_HUNT';
  phase: 'PLAYING' | 'RESULT';
  assignedColours: Record<string, { name: string; hex: string; snackHint: string }>;
}

export interface ColourHuntGameStateDTO {
  type: 'COLOUR_HUNT';
  phase: 'PLAYING' | 'RESULT';
  myColour?: { name: string; hex: string; snackHint: string };
  allColours?: Record<string, { name: string; hex: string; snackHint: string }>;
}

/** HALF: bluffers see the first half of the explanation. HINTS: 3 hints, only one true. */
export type BluffMode = 'HALF' | 'HINTS';
export type BluffRole = 'HONEST' | 'BLUFFER' | 'GUESSER';

export interface BluffCard {
  word: string;
  reading?: string;      // pinyin or original-language name
  category: string;
  explanation: string;
  firstHalf: string;     // literal prefix of explanation
  trueHint: string;
  decoyHints: string[];
}

export interface BluffKingGameState {
  type: 'BLUFF_KING';
  phase: 'PLAYING' | 'REVEAL' | 'RESULT';
  mode: BluffMode;
  hostIsPlaying: boolean;
  round: number;
  totalRounds: number;
  card: BluffCard;
  usedWords: string[];
  roles: Record<string, BluffRole>;
  speakerOrder: string[];
  bluffHints: Record<string, string[]>;  // bluffer → 3 shuffled hints (HINTS mode)
  honestLocked: boolean;                 // honest used up their viewing time
  votes: Record<string, string>;         // guesser → speaker
  votedPlayerIds: string[];
  scores: Record<string, number>;
  roundGains: Record<string, number>;
  crownedIds: string[];                  // bluffers with most votes this round
  speakCounts: Record<string, number>;
  honestCounts: Record<string, number>;
}

export interface BluffKingGameStateDTO {
  type: 'BLUFF_KING';
  phase: 'PLAYING' | 'REVEAL' | 'RESULT';
  mode: BluffMode;
  round: number;
  totalRounds: number;
  word: string;
  reading?: string;
  category: string;
  speakerOrder: string[];
  guesserIds: string[];
  votedPlayerIds: string[];
  scores: Record<string, number>;
  myRole?: BluffRole;
  myExplanation?: string;   // honest (until locked)
  honestLocked?: boolean;   // honest only
  myFirstHalf?: string;     // bluffer, HALF mode
  myHints?: string[];       // bluffer, HINTS mode
  myVoteTarget?: string;
  // Revealed after voting, or always for a non-playing host:
  honestId?: string;
  explanation?: string;
  firstHalf?: string;
  trueHint?: string;
  allHints?: Record<string, string[]>;
  revealedVotes?: Record<string, string>;
  roundGains?: Record<string, number>;
  crownedIds?: string[];
}

export type GameState = UndercoverGameState | TaskWolfGameState | ColourHuntGameState | BluffKingGameState | null;
export type GameStateDTO = UndercoverGameStateDTO | TaskWolfGameStateDTO | ColourHuntGameStateDTO | BluffKingGameStateDTO;
