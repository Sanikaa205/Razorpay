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

### Authentication
- Email/password signup and login (`POST /api/auth/signup`, `POST /api/auth/login`),
  passwords hashed with bcrypt, session issued as a JWT in an httpOnly cookie
  (`POST /api/auth/logout` clears it, `GET /api/auth/me` reads the current session).
- All merchant-only routes (`/api/merchant`, `/api/products`, `/api/orders` list
  endpoint, `/api/audit-logs`) are gated by a `requireAuth` middleware that reads
  this cookie; a merchant can only ever see or modify their own data
  (`merchantId` always comes from the session, never a request parameter).
- No password reset, email verification, or role/permission system beyond a
  single "merchant" account type.

### Catalog upload & CSV/Excel transformation
- Add a product manually, with an optional uploaded photo file or an image
  URL (`POST /api/products`, multipart).
- Edit price, stock, and a blocked/sellable toggle per product directly in
  the Catalog table (`PATCH /api/products/:id`); the table polls every 5s so
  stock changes from live orders show up automatically.
- **Bulk upload via CSV or Excel (.csv/.xlsx/.xls) with arbitrary column
  names**, as a two-phase preview/confirm flow:
  1. `POST /api/products/upload-csv/preview` parses the file and auto-maps
     whatever columns it finds onto the catalog schema (name, price,
     material, color, sizes, stock, photo) — using an Anthropic (Claude)
     tool-call mapper when `ANTHROPIC_API_KEY` is set, or a dependency-free
     rule-based synonym/fuzzy-match mapper otherwise. It then cleans and
     infers values: parses "₹1,499" / "Rs. 899" style prices, infers a
     missing material/color from the product name against a built-in
     dictionary, defaults missing sizes to "Free Size", and flags rows it
     couldn't confidently transform. Returns a per-row before/after preview
     with those flags — nothing is saved yet.
  2. The merchant reviews the preview in the UI and confirms
     (`POST /api/products/upload-csv/confirm`), which saves only the rows
     marked valid (a missing name or price marks a row invalid), each with
     its original raw row preserved as `Product.rawData` for traceability.
- Product photos render through a component with a loading skeleton and a
  guaranteed inline-SVG fallback if the URL is missing, malformed, or fails
  to load, so a bad merchant-supplied image link never shows as broken.

### Store AI matching
- `POST /api/store-ai/query` answers a buyer's free-text query strictly from
  that merchant's real, non-blocked, AI-ready catalog.
- Uses Google Gemini (`GEMINI_API_KEY`, constrained structured JSON output)
  when configured; otherwise — and on any Gemini failure (rate limit,
  timeout, bad response) — falls back transparently to a deterministic
  keyword/token-overlap matcher that also gates by garment category
  (e.g. never suggests a kurta for a saree query) and an "under ₹X" price
  ceiling parsed from the query text.
- Every response is reconciled against the real database record for the
  matched product id: price, stock, sizes, etc. are always rebuilt
  server-side from that record, never taken from the model's output, so a
  hallucinated field can never reach the buyer. If the model names a
  product id that doesn't exist in the catalog, the match is discarded and
  the event is logged as a blocked hallucination.
- `GET /api/directory` additionally lets a buyer/agent discover an AI-ready
  merchant without already knowing a `merchantId` — optionally filtered by
  garment category and a max budget — picking the single best candidate
  (most matching products, tie-broken by lowest price). The generic
  `/store` route runs this discovery step before handing off to that
  merchant's Store AI.
- Every query is stored as a `Conversation` (with an optional buyer session
  id) and logged to the audit trail.

### Customer/buyer flow
- The `/store/:merchantId` (or generic `/store`) chat page lets a buyer ask
  about products in natural language, see the matched product with real
  stock/price/sizes, pick a size (when the product has more than one
  option) and a quantity (capped at real stock), and confirm an order
  (`POST /api/orders/confirm`).
- A buyer session id (a random id persisted in `sessionStorage`, not a real
  identity) is sent with every query and order so the merchant dashboard can
  tell separate sessions apart.
- Out-of-stock products cannot be ordered; the order-confirm endpoint also
  independently re-checks stock server-side before creating an order.

### Order approval rules
- There is **no merchant manual-approval step** in the current code path:
  every confirmed order is created with status `auto_approved` and goes
  straight to payment creation. The `Merchant.autoApproveLimit` and
  `Merchant.requireManualApproval` database columns and the
  `pending_approval` / `merchant_approved` / `rejected` order statuses still
  exist in the schema, and `autoApproveLimit`/`requireManualApproval` are
  still returned in the merchant profile response, but nothing in the
  current code ever sets an order to those statuses, and there is no
  `/approve` or `/reject` endpoint — they are effectively unused leftovers,
  **not a working manual-approval feature**.
- The one real gate is a fixed **₹1,000 customer-side confirmation
  threshold** (`CUSTOMER_APPROVAL_THRESHOLD` in `orders.ts`): an order at or
  under ₹1,000 proceeds straight to payment; an order over ₹1,000 requires
  a second, explicit confirmation from the buyer (`highValueConfirmed:
  true`) before the order row is even created. This applies uniformly to
  every merchant and is not configurable per merchant.

### Razorpay payment integration
- Payment is collected via Razorpay's embedded Checkout widget: on order
  confirmation the server creates a Razorpay Order via the Razorpay SDK
  (`server/src/lib/payment.ts`) and the browser opens Checkout against that
  order id directly — no Razorpay Payment Link is created or used.
- `POST /api/webhooks/razorpay` verifies the webhook payload's HMAC-SHA256
  signature (`RAZORPAY_WEBHOOK_SECRET`) using a timing-safe comparison, and
  is the sole source of truth for payment status: `payment.captured` marks
  the order `paid` and stamps `paidAt`; `payment.failed` marks it `failed`.
  An invalid signature is rejected before any event is processed.
- The buyer page polls `GET /api/orders/:id` so the order status update
  driven by the webhook appears without a page refresh.
- A failed Razorpay API call while creating the order is caught, logged to
  the audit trail, and does not roll back the already-created order —
  payment creation can be considered a separate, retryable step.

### Stock management
- Stock is decremented by the order's quantity **exactly once**, and only
  when the webhook reports `payment.captured` — never at order creation,
  confirmation, or while a payment is merely pending. A `stockDeducted` flag
  on the order guards against a duplicate/retried webhook delivery
  double-deducting the same order.
- A failed payment never touches stock (nothing to roll back, since it was
  never decremented).
- The decrement is done in a single Prisma transaction alongside the order
  update, with an extra clamp-to-zero safeguard in case a race between two
  concurrent orders' independent stock checks briefly lets it go negative.
- The Catalog table polls every 5 seconds, so a merchant sees stock drop
  from a real buyer purchase without refreshing the page.

### Audit trail
- Every significant server-side event is written to a generic `AuditLog`
  table (`step`, `outcome`, JSON `metadata`, optional `merchantId`/`orderId`):
  Store AI queries (including blocked hallucinations), merchant-directory
  lookups, order confirmations, payment creation, webhook-driven payment
  status changes, and stock decrements.
- `GET /api/audit-logs` (merchant-scoped, never another merchant's data)
  supports filtering by `status` (the log's `outcome`) and a `from`/`to`
  date range.
- The dashboard's **Live Orders & Audit Trail** page turns these raw log
  rows into a human-readable narrative feed (e.g. "AI Shopping Agent asked
  about '...' → shown Product X" or "stock decreased by 2 units"), live
  every 4 seconds.

### Merchant dashboard (pulls the above together)
- **Onboarding**: account status, connecting a Razorpay account reference
  (`PATCH /api/merchant/razorpay-account` — stores a string reference, not a
  real Razorpay Connect/OAuth flow), and the catalog upload forms, plus the
  shareable storefront link.
- **Catalog**: product table with inline price/stock editing and the
  blocked/sellable toggle, the add-product form, and the CSV upload card.
- **Payments**: live-polled list of every order (product, size, qty,
  amount, requesting buyer session, status, Razorpay payment id, paid-at
  timestamp) plus revenue/paid/pending/failed summary tiles computed only
  from real order rows.
- **Live Orders & Audit Trail**: described above.
- Per-product blocking (excluding a product from Store AI matching
  entirely) is saved via `PATCH /api/merchant/settings` (`blockedProductIds`),
  which sets `Product.blocked` for the merchant's catalog in one transaction.

### Not yet implemented
- Merchant manual order approval/rejection (see "Order approval rules" above).
- Any refund, cancellation, or post-purchase order-management flow.
- Password reset / email verification / multi-user merchant accounts.
- A real Razorpay Connect/OAuth account-linking flow (the account "id" is
  just a free-text reference string today).

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
