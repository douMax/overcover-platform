# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sandcastle is a real-time social game platform for mobile web browsers, enabling face-to-face multiplayer games. Current games: "Who is Undercover" (谁是卧底), "Task-based Werewolf" (TaskWolf/任务狼人杀) and "Bluff King" (谁是瞎掰王). Design aesthetic is vaporwave/neon/Arc-style with glassmorphism.

## Commands

```bash
# Development (run in separate terminals)
npm run dev:backend        # Backend dev server (port 5050, ts-node-dev with auto-restart)
npm run dev:frontend       # Frontend dev server (port 3000, Vite)

# Build
npm run build:backend      # TypeScript compilation → backend/dist/
npm run build:frontend     # TypeScript + Vite bundle

# Testing (manual — no automated test framework configured)
cd backend && npm run test:socket   # Runs test-socket.js (Socket.io integration test)
curl http://localhost:5050/health   # Health check

# Install dependencies (each workspace separately)
cd backend && npm install
cd frontend && npm install
```

## Architecture

**Monorepo with 3 workspaces:** `backend/`, `frontend/`, `shared/`

- **shared/** — Pure TypeScript types, DTOs, and Socket.io event constants. No runtime dependencies. Imported by both backend and frontend via TypeScript project references.
- **backend/** — Node.js + Express + Socket.io server. In-memory state only (no database).
- **frontend/** — React 18 + Vite + Tailwind CSS + Framer Motion. Uses `@/` alias for `src/` and `@shared/` alias for `shared/`.

### Key Architectural Patterns

**Strategy pattern for games:** `BaseGame` abstract class in `backend/src/games/base-game.ts` with concrete implementations (`UndercoverGame`, `TaskWolfGame`). Each game handles its own state transitions and player data sanitization.

**Full-state push model:** Server broadcasts the entire `RoomState` to all players on every state change. No partial updates or client-side merging. Before broadcasting, backend sanitizes data per-player (e.g., civilians don't see the undercover word).

**Socket.io event-driven:** All game interactions go through Socket.io events. Event name constants live in `shared/events.ts` — no magic strings. No REST API for game logic (only `/health` endpoint).

**Frontend state:** Global socket singleton managed by `useSocket` hook. Player identity (ID, nickname, avatar) persisted in localStorage for reconnection.

### Data Flow

1. Players join a room via Socket.io events
2. Host starts game → backend assigns roles/words, sanitizes per player, broadcasts state
3. Frontend receives `UPDATE_ROOM_STATE` → `setGameState(data)` (no merging logic needed)
4. Player data is sanitized in `backend/src/utils/player-sanitizer.ts` and game-specific overrides

## Conventions

- **TypeScript strict mode** across all workspaces, no `any` types
- **Event names** must use constants from `shared/events.ts` (e.g., `GameEvents.JOIN_ROOM`)
- **DTOs** in `shared/dto/` separate frontend-visible data from backend internals (e.g., `socketId` never sent to clients)
- **All documentation** goes in `docs/` — game rules in `docs/prd-prompt.md`, word pairs in `docs/word-list.md`, Bluff King cards in `docs/bluff-list.md` (parsed at runtime — keep its field format)
- **Styling:** Dark gradients (`#0F172A` to `#020617`), cream cards (`#FFFDF0`), neon glow via Tailwind shadow utilities, Framer Motion for animations
- **Mobile-first:** UI optimized for mobile browsers. Hold-to-reveal cards use 1.5s long-press with blur filter. Haptic feedback via `navigator.vibrate()`.

## Room Lifecycle

WAITING (lobby) → PLAYING (game active) → RESULT (game ended). Host disconnect deletes room; player disconnect allows rejoin.
