import { Room } from '../../../shared/types/room';
import { Player, PlayerDTO } from '../../../shared/types/player';
import { GameState } from '../../../shared/types/game-state';
import { sanitizePlayer } from '../utils/player-sanitizer';
import { ContentGame } from '../content/content-store';

/** The card/round a player's feedback applies to right now */
export interface FeedbackTarget {
  roundId: number;
  cardId: string;
  game: ContentGame;
}

/**
 * Abstract base class for all game engines
 * Implements the Strategy pattern for extensible game logic
 */
export abstract class BaseGame {
  protected room: Room;
  protected gameState: GameState;

  constructor(room: Room) {
    this.room = room;
    this.gameState = null;
  }

  abstract onStart(config: any): void;
  abstract onAction(action: string, data: any): void;
  abstract onEnd(): void;

  /** Override in games backed by the card bank; null means nothing to rate now */
  getFeedbackTarget(): FeedbackTarget | null {
    return null;
  }

  getGameState(): GameState {
    return this.gameState;
  }

  /**
   * Returns a sanitized version of the game state for a specific viewer.
   * Override in subclasses for game-specific sanitization.
   */
  sanitizeGameState(viewerId: string): unknown {
    return this.gameState;
  }

  sanitizePlayerData(player: Player, viewerId?: string): PlayerDTO {
    return sanitizePlayer(player, viewerId);
  }

  getSanitizedPlayers(viewerId?: string): PlayerDTO[] {
    return this.room.players.map((player) =>
      this.sanitizePlayerData(player, viewerId)
    );
  }
}
