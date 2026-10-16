这是一份为 AI 编程助手（如 Antigravity, Cursor, Windsurf 或 VS Code Copilot）高度优化的 **项目需求指令文档 (PRD Prompt)**。

你可以将其直接复制并粘贴到对话框中，作为项目的初始化指令。

---

# Project Specification: VaporGame Hub (Multiplayer Social Game Platform)

## 1. Project Overview

Build a lightweight, real-time interactive game platform optimized for mobile web. The initial focus is on "Who is Undercover" and "Task-based Werewolf (TaskWolf)".

- **Core Aesthetic:** Vaporwave / Neon / Arc-style (frosted glass, vibrant gradients).
- **Key Interaction:** Real-time state syncing via WebSockets.
- **Player Roles:** Host (Manager) and Players. The Host can choose to join the game as a participant or stay as an observer.

## 2. Tech Stack

- **Frontend:** React (Vite), Tailwind CSS, Framer Motion (for animations).
- **Backend:** Node.js, TypeScript, Express.
- **Real-time:** Socket.io.
- **State Management:** Redis (for room/game state) or in-memory for MVP.
- **Styling:** Tailwind CSS with custom neon/glassmorphism utilities.

## 3. Architecture Design

### A. Strategy Pattern for Games

Implement a `GameEngine` abstract class to allow adding new games easily.

```typescript
interface GameEngine {
  onStart(room: Room, params: any): void;
  onAction(action: string, data: any): void;
  onEnd(): void;
  getGameState(): any;
}
```

### B. Core Data Models

- **Room:** `id, status (IDLE, PLAYING, VOTING, RESULT), gameType, players, hostId, config`.
- **Player:** `id, socketId, nickname, avatar, role, word, task, isAlive, isHost, isPlaying`.

## 4. Specific Game Logic

### Game 1: Who is Undercover (谁是卧底)

1. **Setup:** Host selects word pair (A, B) and number of undercovers (X).
2. **Assignment:**
   - Randomly assign $X$ players as "Undercover", others as "Civilian".
   - If `host.isPlaying` is true, include host in the pool.
3. **Visibility:** Players **only** see their word, NOT their role.
4. **Flow:** Manual progression by Host. Host can trigger "Voting Mode".

### Game 2: Task-Based Werewolf (任务狼人杀)

1. **Setup:** Host assigns "Wolf" and "Villager" roles.
2. **Tasks:** Host can manually input a "Secret Task" for each Wolf (e.g., "Use a specific phrase").
3. **Visibility:** Players see their Role (Wolf/Villager). Wolves also see their Secret Task.
4. **Execution:** Host monitors the game and manually marks players as "Out" when a task is completed or via vote.

### Game 3: Bluff King (谁是瞎掰王)

Inspired by Fictionary / Balderdash / 9upper. Card bank: `docs/bluff-list.md`.

1. **Setup (host config):**
   - **Hint mode** — `HALF` (前半段) or `HINTS` (三选一). Chosen before the game; host may switch between rounds.
   - **Rounds** — multi-round game with cumulative scores (default = number of players, so the Honest role rotates through everyone).
   - **Host plays** — toggle (`host.isPlaying`). If the host is not playing, they act as MC and see the full card.
   - Minimum 4 playing players.
2. **Roles (per round):**
   - Speakers = `min(playerCount - 1, 5)`: 1 **Honest** (老实人) + the rest **Bluffers** (瞎掰王).
   - Everyone else is a **Guesser** (猜词人) — at least 1.
   - Honest rotates each round; speakers are drawn from players with the fewest speaking turns so everyone gets to guess.
3. **Visibility:**
   - Everyone sees the word + pronunciation and the speaking order.
   - Honest: full explanation, hold-to-reveal for a **10s total budget**, then locked (stops verbatim reading).
   - Bluffers in `HALF` mode: the first-half text. In `HINTS` mode: 3 hints (1 true + 2 random decoys, shuffled; combos may differ per bluffer). Bluffers do not know which hint is true.
   - Guessers: word only. No one sees others' roles until reveal.
4. **Flow:** Reveal cards → speakers explain offline in app-generated random order (host can swap the card via 换一题; roles stay) → host opens voting → each Guesser votes for one speaker as the Honest → reveal roles, full explanation and votes → scores → next round.
5. **Scoring:**
   - Guesser votes for the Honest: Guesser +1, Honest +1 (per correct vote).
   - Each vote a Bluffer receives: that Bluffer +1. Bluffer with most votes is crowned the round's 瞎掰王.
   - Final leaderboard after the last round.

## 5. UI/UX Requirements (Arc/Vaporwave Style)

- **Background:** Deep dark gradient `linear-gradient(180deg, #0f172a 0%, #020617 100%)`.
- **Identity Card:**
  - Off-white/Cream card base (`#FFFDF0`).
  - Top section: Arc-style irregular colorful wave gradient.
  - Interactive: **"Hold to Reveal"** (Blur filter `blur(20px)` on text, removed on `longpress`).
- **Animations:**
  - Glassmorphism overlays for modals.
  - Neon glow borders for active players.
  - Smooth transitions between Lobby and Game screens.
- **Mobile First:** All layouts must be responsive and touch-friendly.

## 6. Socket API Definition

- `join_room(roomId, nickname, isHost)`
- `update_room_state`: Broadcasted to all players on any change.
- `start_game(gameType, config)`: Sent by Host.
- `set_player_status(targetId, status)`: Host marks someone dead/alive.
- `start_vote(options)`: Host triggers voting UI for all.
- `reveal_results`: Host ends game and shows all roles/words.

## 7. Implementation Phases

### Phase 1: Core Infrastructure

- Setup Express + Socket.io + TypeScript.
- Room creation and joining logic.
- Basic Lobby UI with "Vaporwave" styling.

### Phase 2: "Undercover" Implementation

- Word pair library (use the 50 provided pairs).
- Role shuffling and private word distribution.
- "Hold to Reveal" card component.

### Phase 3: "Task-based Werewolf" & Management

- Host dashboard to mark players "Out".
- Custom task input for specific players.
- Voting UI system.

### Phase 4: Visual Polish

- Add Framer Motion animations.
- Arc-style CSS implementation.
- Sound effects (optional).

---

## 50 Word Pairs for "Undercover" (Inject into Database/JSON)

`[{"A":"状元","B":"榜眼"},{"A":"眉毛","B":"睫毛"},{"A":"衬衫","B":"T恤"}, ...]`
Full list in /docs/word_list.md

---

**Instruction for AI:**
"Please start by initializing the project structure. Focus on the Backend `RoomManager` and the Frontend `Arc-style Identity Card` component first. Use Tailwind CSS for all styling."
