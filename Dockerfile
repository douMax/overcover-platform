FROM node:22-slim AS build

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app

# Copy workspace config and package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY docs/ ./docs/
COPY shared/ ./shared/
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Build
RUN pnpm run build

# Copy shared compiled output to shared root so require("../../../shared/events") resolves
RUN cp -r /app/shared/dist/* /app/shared/

# Self-contained production deps for the backend (pnpm's workspace node_modules are
# symlinks into /app/node_modules/.pnpm, which the production image doesn't have)
RUN pnpm --filter overcover-backend deploy --prod --legacy /app/backend-prod

# Production image
FROM node:22-slim

WORKDIR /app

COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend-prod/node_modules ./backend/node_modules
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/shared ./shared
COPY --from=build /app/docs ./docs
COPY --from=build /app/package.json ./

EXPOSE 8080
ENV PORT=8080
ENV NODE_ENV=production

CMD ["node", "backend/dist/index.js"]
