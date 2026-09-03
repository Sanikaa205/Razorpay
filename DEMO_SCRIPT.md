# Demo Script — AI Agent Storefront (5 minutes)

This walks through the full merchant + buyer flow end-to-end, matching the
grading flow: onboarding → grounded AI match → safety gate → Razorpay
payment → audit trail, plus the two required edge cases (over-limit order,
no-catalog-match query).

## Before you go live

1. **Build for the demo instead of using the dev server** — `npm run dev`
   recompiles each route the first time it's visited, which shows up as a
   multi-second stall on stage. Use a production build instead:
   ```bash
   npm run build --workspace shared
   npm run build --workspace client && npm run preview --workspace client
   npm run build --workspace server && npm start --workspace server
   ```
   (or, if short on time, just click through every dashboard tab once with
   `npm run dev` running, so Vite has already compiled them.)
2. **Reset to a clean dataset**: `npm run prisma:seed --workspace server`.
   This resets the seeded merchant to zero orders/conversations/audit
   history with a fresh 20-product catalog (see credentials below) — safe to
   re-run right before you go on stage.
3. **Confirm live keys are set** in `server/.env`: `ANTHROPIC_API_KEY`,
   `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, and
   that your Razorpay test-mode webhook is pointed at
   `POST /api/webhooks/razorpay` (use a tunnel like `ngrok` if presenting
   from a laptop with no public URL). Without these, the AI matching and
   payment steps cannot run live — see the banner note in step 4 below.
4. Have two browser windows side by side: the **merchant dashboard**
   (logged in) and the **buyer chat page** (`/store/<merchantId>`, no
   login) — you'll switch between them constantly.

**Seeded fallback account** (from `npm run prisma:seed`), useful if the live
signup in step 2 has an issue:
- Email: `owner@fashionhub.test`
- Password: `Demo@1234`

---

## Script

| # | Time | Step | What to do | Say | Expected outcome |
|---|------|------|------------|-----|-------------------|
| 1 | 0:00–0:15 | Intro | — | "This is an AI agent that sells for a merchant — but it can only ever recommend real products from their catalog, and it never moves money without a human-configurable safety gate." | — |
| 2 | 0:15–1:00 | **Onboarding** | Go to `/signup`. Sign up as a new merchant (any name/email/password). You land on the Onboarding screen. Type any string (e.g. `acct_test_demo`) into the Razorpay field and click **Connect**. Choose `demo/demo-products.csv` (or the deliberately messy `messy-sample-catalog.csv` for extra impact), click **Preview**, glance at the before/after per-row comparison, then **Confirm & save**. | "Three steps, one screen: create the account, connect Razorpay, upload the catalog — and watch it auto-map messy real-world column names before it ever touches the live catalog." | All three onboarding steps show a green check; catalog shows the uploaded products. |
| 3 | 1:00–1:15 | **Safety Settings** | Go to the Safety Settings tab. Set **Auto-approve orders under (₹)** to `1000`, leave "require manual approval" off, click **Save settings**. | "This one number is the entire safety gate — anything at or under ₹1000 the agent can approve itself; anything over it waits for me." | "Settings saved." confirmation. |
| 4 | 1:15–1:45 | **Grounded AI match** | Open the buyer chat page in the second window (`/store/<merchantId>` — copy the id from the dashboard URL or `GET /api/merchant/me`). Type exactly: `birthday dress, sky blue mesh, front criss-cross, under ₹800` | "Watch — it can only answer using the real catalog I just uploaded, nothing invented." | A product card appears: **Sky Blue Mesh Criss-Cross Dress**, ₹749, Mesh / Sky Blue / S,M,L, with photo. `action_type: order_attempt`, no "Closest match" label (it's an exact match). |
| 5 | 1:45–2:00 | **Confirm → auto-approve** | Click **Confirm order**. | "₹749 is under my ₹1000 limit, so no human needed — watch it clear instantly." | Status flips to "Order auto-approved!" and a **Pay with Razorpay** button appears within ~1s. |
| 6 | 2:00–2:30 | **Live payment** | Click **Pay with Razorpay**. Complete the hosted checkout with a Razorpay test card (Visa `4111 1111 1111 1111`, any future expiry, any CVV) — or use Razorpay's test-mode "Success" control if your checkout offers one. Return to the buyer tab. | "This is a real Razorpay test-mode payment link and a real webhook coming back." | Within ~3s (the page polls every 3s) the status updates to "Payment successful — your order is confirmed!" with no manual refresh. |
| 7 | 2:30–3:00 | **Audit trail** | Switch to the dashboard, open **Live Orders & Audit Trail**. | "Every one of those steps — the query, the match, the confirm, the approval, the payment — is one readable, timestamped line." | One story reads: *"AI agent asked about 'birthday dress, sky blue mesh, front criss-cross, under ₹800' → shown Sky Blue Mesh Criss-Cross Dress → user confirmed → order auto-approved (...) → payment received via Razorpay"*. |
| 8 | 3:00–4:00 | **Edge case 1 — over the limit** | Back in the buyer tab, ask: `Do you have the Banarasi Silk Saree?` (₹1999). Confirm the order. Switch to the dashboard's **Live Orders** or **Payments** tab, find the order, click **Approve**. Pay via the new payment link the same way as step 6. | "Same agent, same flow — but ₹1999 is over my limit, so it stops and waits for me instead of guessing." | Order confirms as `pending_approval` (not auto-approved). After clicking Approve in the dashboard, status becomes `merchant_approved` and a payment link appears; after payment, status becomes `paid`. |
| 9 | 4:00–4:30 | **Edge case 2 — no real match** | In the buyer tab, ask something with nothing close in the catalog, e.g.: `Do you have a black leather biker jacket in size XXL?` | "Nothing in this catalog is a leather jacket — so it either offers the closest real thing and says so, or honestly says it doesn't have a match. It will never invent a product to look helpful." | Either a real catalog item labeled **"Closest match"**, or a plain "no match" message with `matched_product: null` — never a fabricated product/price. |
| 10 | 4:30–4:50 | **Wrap-up** | Switch to the **Payments** tab. | "And the merchant's whole settlement picture — every order, every Razorpay status, the total actually collected — is one screen." | Settlement total reflects the paid order(s) from steps 6 and 8. |

Buffer: ~10–15s for transitions/questions.

## Exact queries used above

1. `birthday dress, sky blue mesh, front criss-cross, under ₹800` → real exact match (Sky Blue Mesh Criss-Cross Dress, ₹749)
2. `Do you have the Banarasi Silk Saree?` → real exact match, ₹1999 (over the ₹1000 limit — triggers manual approval)
3. `Do you have a black leather biker jacket in size XXL?` → no real match in the catalog (proves grounding / no hallucination)

## If something misbehaves live

- **AI request fails outright**: check `ANTHROPIC_API_KEY` is set on the server and the server process was restarted after setting it.
- **Payment link doesn't appear**: check `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`; the order/approval still succeeds even if payment link creation fails (fails closed, logged to the audit trail as `payment_created` / `error` — worth showing if it happens, it's the fallback behavior working as designed).
- **Payment status doesn't update after paying**: the webhook needs a reachable URL; if presenting locally, confirm your tunnel (e.g. `ngrok`) is still forwarding to `/api/webhooks/razorpay` and that URL is set in the Razorpay Dashboard's test-mode webhook config.
