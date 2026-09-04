# AI Agent Storefront

A full-stack app that lets a fashion merchant onboard a product catalog and
sell through an AI shopping agent: buyers chat in natural language, the
agent recommends only real, in-stock catalog items (never invented ones),
and confirmed orders are paid for through Razorpay with stock deducted the
moment a payment actually clears.

## Structure

```
/server   Node.js + Express + TypeScript REST API (Prisma + Postgres)
/client   React + TypeScript + Vite + Tailwind CSS frontend
/shared   TypeScript types (and small query-parsing helpers) shared between server and client
```

## What's implemented

### Merchant accounts & onboarding
- Email/password signup and login (`POST /api/auth/signup`, `/login`), JWT stored in an
  httpOnly cookie, session lookup via `GET /api/auth/me`.
- An Onboarding page walks a merchant through: account created → connect a
  Razorpay account reference (`PATCH /api/merchant/razorpay-account`) → upload
  a catalog. It shows a shareable storefront link (`/store/:merchantId`) once
  products exist.

### Catalog management
- Add a product manually, with an optional uploaded photo file or an image
  URL (`POST /api/products`, multipart).
- Edit price, stock, and a blocked/sellable toggle per product directly in
  the Catalog table (`PATCH /api/products/:id`); the catalog table polls
  every 5s so stock changes from live orders show up automatically.
- **Bulk upload via CSV or Excel (.csv/.xlsx/.xls) with arbitrary column
  names.** This is a two-phase flow:
  1. `POST /api/products/upload-csv/preview` parses the file, auto-maps
     whatever columns it finds onto the catalog schema (name, price,
     material, color, sizes, stock, photo) using either an Anthropic
     (Claude) tool-call mapper when `ANTHROPIC_API_KEY` is set, or a
     dependency-free rule-based synonym/fuzzy matcher otherwise, cleans and
     infers values (parses "₹1,499"/"Rs. 899" style prices, infers
     material/color from the product name when no column exists, defaults
     missing sizes to "Free Size"), and returns a per-row before/after
     preview with any warnings/errors — nothing is saved yet.
  2. The merchant reviews the preview in the UI and confirms
     (`POST /api/products/upload-csv/confirm`), which saves only the valid
     rows, each with its original raw row preserved as `Product.rawData`
     for traceability.
- Product photos render through a component that shows a loading skeleton
  and falls back to an inline placeholder graphic if the URL is missing,
  malformed, or fails to load — so a bad merchant-supplied image link never
  shows a broken-image icon.

### AI shopping agent (Store AI)
- `POST /api/store-ai/query` answers a buyer's free-text query strictly from
  that merchant's real, non-blocked catalog.
- Uses Google Gemini (`GEMINI_API_KEY`, structured JSON output) when
  configured; otherwise — and on any Gemini failure (rate limit, timeout,
  bad response) — falls back transparently to a deterministic keyword/
  token-overlap matcher that also gates by garment category and an "under
  ₹X" price ceiling parsed from the query, so it never suggests the wrong
  type of product.
- Every response is reconciled against the real database record for the
  matched product id: price, stock, sizes, etc. are always rebuilt
  server-side, so a hallucinated field can never reach the buyer. If the
  model names a product id that doesn't exist in the catalog, the match is
  discarded and logged as a blocked hallucination.
- Every query is stored as a `Conversation` (with an optional buyer session
  id) and logged to the audit trail.

### Multi-merchant discovery
- `GET /api/directory` lets a buyer/agent find an AI-ready merchant without
  already knowing a `merchantId` — optionally filtered by garment category
  and a max budget — and picks the single best candidate (most matching
  products, tie-broken by lowest price), with a one-line reason. Logged to
  the audit trail as a `merchant_discovery` step.
- The generic `/store` route (no merchant id) runs this discovery step
  first, then hands off to that merchant's own Store AI.

### Buyer checkout flow
- The `/store/:merchantId` (or generic `/store`) chat page lets a buyer ask
  about products, pick a size (when the matched product has more than one)
  and quantity (capped at real stock), and confirm an order
  (`POST /api/orders/confirm`).
- Orders at or under a fixed ₹1,000 threshold go straight to payment; orders
  above it require a second explicit confirmation from the buyer first
  (`highValueConfirmed`) before an order row is even created.
- Payment is collected via Razorpay's embedded Checkout widget: the server
  creates a Razorpay Order (`POST` via the Razorpay SDK) and the browser
  opens Checkout against it directly — no Payment Link involved.
- `POST /api/webhooks/razorpay` verifies the webhook's HMAC signature and is
  the sole source of truth for payment status: on `payment.captured` it
  marks the order `paid`, stamps `paidAt`, and decrements the product's
  stock exactly once (guarded against duplicate webhook delivery); on
  `payment.failed` it marks the order `failed` without touching stock.
- The buyer page polls `GET /api/orders/:id` to reflect the webhook-driven
  status change without a page refresh.

### Merchant dashboard
- **Payments** page: live-polled list of every order (product, size, qty,
  amount, requesting buyer session, status, Razorpay payment id, paid-at
  timestamp), plus revenue/paid/pending/failed summary tiles computed only
  from real order rows.
- **Live Orders & Audit Trail** page: a live-polled, human-readable feed
  built from the raw `AuditLog` table (AI query results, hallucinations
  blocked, order confirmations, payment status changes, stock decrements),
  filterable by outcome and date range.
- **Catalog** page: product table with inline price/stock editing and the
  blocked/sellable toggle, plus the add-product form and CSV upload card.
- Per-product blocking is saved via `PATCH /api/merchant/settings`
  (`blockedProductIds`), which sets `Product.blocked` for the merchant's
  catalog in one transaction.

## Environment variables

### `server/.env`

| Variable                  | Required | Description                                                                 |
| -------------------------- | -------- | ---------------------------------------------------------------------------- |
| `PORT`                     | no       | Port the Express server listens on (defaults to 4000)                        |
| `DATABASE_URL`             | yes      | Postgres connection string (used by Prisma)                                  |
| `JWT_SECRET`               | yes      | Secret used to sign the merchant auth cookie                                 |
| `CLIENT_URL`               | yes      | Origin allowed by CORS (the Vite dev server URL)                             |
| `ANTHROPIC_API_KEY`        | no       | Enables Claude-based CSV column mapping; falls back to a rule-based mapper otherwise |
| `GEMINI_API_KEY`           | no       | Enables Gemini-based Store AI matching; falls back to a deterministic keyword matcher otherwise |
| `RAZORPAY_KEY_ID`          | yes*     | Razorpay key id (needed to actually create Razorpay orders)                  |
| `RAZORPAY_KEY_SECRET`      | yes*     | Razorpay key secret                                                          |
| `RAZORPAY_WEBHOOK_SECRET`  | yes*     | Secret used to verify Razorpay webhook signatures                            |

\* Payment creation and the webhook handler require these; the rest of the
app works without them.

### `client/.env`

| Variable                 | Required | Description                                                    |
| ------------------------- | -------- | ---------------------------------------------------------------- |
| `VITE_API_URL`            | yes      | Base URL of the server API                                       |
| `VITE_RAZORPAY_KEY_ID`    | yes*     | Razorpay key id used client-side to open the Checkout widget     |

\* Needed for the buyer's Pay button to work; the rest of the storefront
chat works without it.

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

2. Create your env files from the examples, then fill in the variables
   described above:

   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

3. Generate the Prisma client and apply migrations (requires `DATABASE_URL`):

   ```bash
   npm run prisma:generate --workspace server
   npm run prisma:migrate --workspace server
   ```

4. Seed demo data — three merchants (FashionHub Boutique, Ethnic Threads
   Co., Urban Edge Wear) across different clothing categories, each with a
   full product catalog. Prints each merchant's login at the end.

   ```bash
   npm run prisma:seed --workspace server
   ```

5. Build the shared types package (server and client both depend on it):

   ```bash
   npm run build --workspace shared
   ```

## Running in development

In two terminals, from the repo root:

```bash
npm run dev:server   # starts the API on http://localhost:4000
npm run dev:client   # starts the Vite dev server on http://localhost:5173
```

Open http://localhost:5173 to sign up or log in as a merchant (or use one of
the seeded demo accounts), or go straight to http://localhost:5173/store to
try the AI shopping agent across all seeded merchants.

## Linting & formatting

```bash
npm run lint            # ESLint for server + client
npm run format          # Prettier write, all workspaces
npm run format:check    # Prettier check, all workspaces
```

## Data model

Postgres via Prisma, with these models: `Merchant`, `Product` (with
`rawData` preserving the original CSV row), `Conversation` (a buyer's Store
AI query, with an optional session id), `Order` (quantity, selected size,
Razorpay ids, `paidAt`, `stockDeducted`), and `AuditLog` (a generic
step/outcome/metadata event log driving the Live Orders & Audit Trail page).

## Health check

`GET /api/health` returns:

```json
{ "status": "ok", "timestamp": "2026-01-01T00:00:00.000Z" }
```
