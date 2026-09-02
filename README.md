# AI Agent Storefront

Monorepo for the AI Agent Storefront full-stack app.

## Structure

```
/server   Node.js + Express + TypeScript REST API (Prisma + Postgres)
/client   React + TypeScript + Vite + Tailwind CSS frontend
/shared   TypeScript types shared between server and client
```

This is currently a skeleton: tooling, project structure, database connection,
and a single `/api/health` endpoint wired end-to-end from the client. No
product features have been built yet.

## Prerequisites

- Node.js 18+
- npm 9+
- A running Postgres instance (local or hosted). For local dev without
  installing Postgres directly, you can run it via Docker:

  ```bash
  docker run -d --name ai-agent-storefront-db \
    -e POSTGRES_USER=postgres \
    -e POSTGRES_PASSWORD=postgres \
    -e POSTGRES_DB=ai_agent_storefront \
    -p 5432:5432 postgres:16-alpine
  ```

## Setup

1. Install dependencies for all workspaces from the repo root:

   ```bash
   npm install
   ```

2. Create your env files from the examples:

   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

   Fill in `server/.env` with your Postgres connection string and any API
   keys you have (Anthropic, Razorpay). If you used the Docker command above,
   `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_agent_storefront?schema=public"`
   works as-is.

3. Generate the Prisma client (requires `DATABASE_URL` to be set):

   ```bash
   npm run prisma:generate --workspace server
   ```

   To create the database schema:

   ```bash
   npm run prisma:migrate --workspace server
   ```

   To seed sample data (1 test merchant + ~19 fashion products):

   ```bash
   npm run prisma:seed --workspace server
   ```

4. Build the shared types package (server and client both depend on it):

   ```bash
   npm run build --workspace shared
   ```

## Running in development

In two terminals, from the repo root:

```bash
npm run dev:server   # starts the API on http://localhost:4000
npm run dev:client   # starts the Vite dev server on http://localhost:5173
```

Open http://localhost:5173 — the page calls `GET /api/health` on the server
and displays the result, confirming the client and server are wired up.

## Linting & formatting

```bash
npm run lint            # ESLint for server + client
npm run format          # Prettier write, all workspaces
npm run format:check    # Prettier check, all workspaces
```

## Environment variables

### `server/.env`

| Variable                  | Description                                 |
| ------------------------- | ------------------------------------------- |
| `PORT`                    | Port the Express server listens on          |
| `DATABASE_URL`            | Postgres connection string (used by Prisma) |
| `ANTHROPIC_API_KEY`       | API key for Claude/Anthropic calls          |
| `RAZORPAY_KEY_ID`         | Razorpay key ID                             |
| `RAZORPAY_KEY_SECRET`     | Razorpay key secret                         |
| `RAZORPAY_WEBHOOK_SECRET` | Secret used to verify Razorpay webhooks     |

### `client/.env`

| Variable       | Description                |
| -------------- | -------------------------- |
| `VITE_API_URL` | Base URL of the server API |

## Health check

`GET /api/health` on the server returns:

```json
{ "status": "ok", "timestamp": "2026-01-01T00:00:00.000Z" }
```
