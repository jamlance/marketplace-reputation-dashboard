# Multi-stage build for the Reputation Dashboard embedded app.
#
# Build context is the monorepo root (Coolify base_directory = /).
#
# The builder installs the FULL workspace and runs vite build. The
# runtime copies the entire workspace (so workspace:* deps resolve)
# plus the dist + server. Pnpm-managed symlinks in node_modules make
# `import "@bookerva-apps/core"` work at runtime without re-resolving.

# --------------------------------------------------------------- builder
FROM node:20-alpine AS builder
WORKDIR /work
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm@9

COPY package.json pnpm-workspace.yaml ./
COPY packages/core ./packages/core
COPY apps/reputation-dashboard ./apps/reputation-dashboard

RUN pnpm install --no-frozen-lockfile

WORKDIR /work/apps/reputation-dashboard
RUN pnpm exec vite build

# --------------------------------------------------------------- runtime
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache git

# Bring the resolved workspace + node_modules over so the app can
# `import "@bookerva-apps/core"` without another install.
COPY --from=builder /work/package.json /work/pnpm-workspace.yaml ./
COPY --from=builder /work/node_modules ./node_modules
COPY --from=builder /work/packages ./packages
COPY --from=builder /work/apps/reputation-dashboard/package.json ./apps/reputation-dashboard/package.json
COPY --from=builder /work/apps/reputation-dashboard/node_modules ./apps/reputation-dashboard/node_modules
COPY --from=builder /work/apps/reputation-dashboard/dist ./apps/reputation-dashboard/dist

COPY apps/reputation-dashboard/server.js ./apps/reputation-dashboard/server.js

EXPOSE 3000
ENV PORT=3000 HOST=0.0.0.0
WORKDIR /app/apps/reputation-dashboard
CMD ["node", "server.js"]
