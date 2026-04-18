/**
 * Hono routes for internal gateway control-plane endpoints.
 *
 * Consumed only by the LangWatch AI Gateway (Go) service. All paths are
 * protected by the shared HMAC secret `LW_GATEWAY_INTERNAL_SECRET` +
 * `X-LangWatch-Gateway-Signature` header. Never expose publicly.
 *
 * Contract source of truth:
 *   specs/ai-gateway/_shared/contract.md §4 (v0.1)
 *
 * Iteration 1: route skeleton + auth middleware + contract-shaped stubs.
 * Real logic follows once the service layer for VirtualKey / Budget lands.
 */
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { timingSafeEqual, createHmac } from "crypto";

import { env } from "~/env.mjs";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";

export const app = new Hono().basePath("/api/internal/gateway");
app.use(tracerMiddleware({ name: "gateway-internal" }));
app.use(loggerMiddleware());

// ── auth middleware ─────────────────────────────────────────────────────

const GATEWAY_SIGNATURE_WINDOW_SECONDS = 300;

/**
 * Verify the gateway's HMAC signature with a replay-protection timestamp.
 *
 * Canonical string:
 *   method + "\n" + path + "\n" + unix_timestamp + "\n" + hex(sha256(body))
 *
 * Headers:
 *   X-LangWatch-Gateway-Signature: hex(hmac_sha256(LW_GATEWAY_INTERNAL_SECRET, canonical))
 *   X-LangWatch-Gateway-Timestamp: unix seconds (±300s window)
 *
 * Rejects when:
 *   - either header is missing
 *   - timestamp is outside the window (captured-and-replayed calls)
 *   - signature does not match
 *
 * Machine-to-machine only; never touches the user session.
 */
async function verifyGatewaySignature(c: Context, next: Next) {
  const secret = process.env.LW_GATEWAY_INTERNAL_SECRET ?? env.LW_GATEWAY_INTERNAL_SECRET;
  if (!secret) {
    return c.json(
      {
        error: {
          type: "internal_error",
          code: "gateway_internal_secret_missing",
          message: "LW_GATEWAY_INTERNAL_SECRET not configured on control-plane",
        },
      },
      500,
    );
  }

  const presentedSig = c.req.header("X-LangWatch-Gateway-Signature");
  const presentedTs = c.req.header("X-LangWatch-Gateway-Timestamp");
  if (!presentedSig || !presentedTs) {
    return c.json(
      {
        error: {
          type: "permission_denied",
          code: "missing_signature",
          message:
            "X-LangWatch-Gateway-Signature and X-LangWatch-Gateway-Timestamp are required",
        },
      },
      401,
    );
  }

  const ts = Number.parseInt(presentedTs, 10);
  if (!Number.isFinite(ts)) {
    return c.json(
      {
        error: {
          type: "permission_denied",
          code: "invalid_timestamp",
          message: "X-LangWatch-Gateway-Timestamp must be unix seconds",
        },
      },
      401,
    );
  }
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > GATEWAY_SIGNATURE_WINDOW_SECONDS) {
    return c.json(
      {
        error: {
          type: "permission_denied",
          code: "timestamp_out_of_window",
          message: `timestamp drift > ${GATEWAY_SIGNATURE_WINDOW_SECONDS}s`,
        },
      },
      401,
    );
  }

  const body = await c.req.raw.clone().text();
  const bodyHash = createHmac("sha256", "").update(body).digest("hex");
  const url = new URL(c.req.url);
  const canonical = `${c.req.method}\n${url.pathname}\n${presentedTs}\n${bodyHash}`;
  const expected = createHmac("sha256", secret).update(canonical).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(presentedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return c.json(
      {
        error: {
          type: "permission_denied",
          code: "invalid_signature",
          message: "signature mismatch",
        },
      },
      401,
    );
  }

  await next();
}

app.use("/*", verifyGatewaySignature);

// ── helpers ─────────────────────────────────────────────────────────────

function notImplemented(c: Context) {
  return c.json(
    {
      error: {
        type: "internal_error",
        code: "not_implemented",
        message:
          "Stub. Contract-shaped response lands once VirtualKey/Budget service layer is wired. See specs/ai-gateway/_shared/contract.md §4.",
      },
    },
    501,
  );
}

// ── routes ──────────────────────────────────────────────────────────────

/**
 * §4.1 — resolve a raw virtual key to a signed JWT + current revision.
 *
 * Request:  { key_presented: "lw_vk_live_01HZX...", gateway_node_id: "gw-eks-abc" }
 * Response: { jwt, revision, key_id, display_prefix }
 */
app.post("/resolve-key", (c) => notImplemented(c));

/**
 * §4.2 — full warm-cache config by vk_id with `If-None-Match: <revision>`.
 * Returns 304 Not Modified when client has current revision.
 */
app.get("/config/:vk_id", (c) => notImplemented(c));

/**
 * §4.3 — long-poll feed of mutations since a given revision.
 *
 * Query: ?since=<revision>&timeout_s=25
 * Response: { current_revision, changes: [{kind, vk_id, revision}, ...] }
 * Returns 204 No Content when no diff within timeout.
 */
app.get("/changes", (c) => notImplemented(c));

/**
 * §4.4 — projective pre-request budget check.
 *
 * Request:  { vk_id, gateway_request_id, projected_cost_usd, model }
 * Response: { decision: allow|soft_warn|hard_block, warnings[], block_reason }
 */
app.post("/budget/check", (c) => notImplemented(c));

/**
 * §4.5 — idempotent post-response debit. Outbox pattern on the platform side;
 * gateway POSTs fire-and-forget with at-least-once retry keyed by
 * `gateway_request_id` (24h dedup window).
 *
 * Request:  { gateway_request_id, vk_id, actual_cost_usd, tokens, model, ... }
 * Response: { deduped, budgets: [{scope, remaining_usd, spent_usd}, ...] }
 */
app.post("/budget/debit", (c) => notImplemented(c));

/**
 * §4.6 — inline guardrail pipeline.
 *
 * Request:  { vk_id, direction, guardrail_ids, content, metadata }
 * Response: { decision: allow|block|modify, reason, modified_content, policies_triggered }
 */
app.post("/guardrail/check", (c) => notImplemented(c));

/**
 * §9 — startup bootstrap. Paginated stream of all non-revoked VK JWTs so the
 * gateway can serve traffic if the control-plane is offline on cold start.
 * Enterprise opt-in (env `LW_GATEWAY_BOOTSTRAP_PULL=true` on gateway side).
 *
 * Query: ?cursor=<opaque>&limit=1000
 * Response: { jwts: [...], next_cursor: null | string, current_revision }
 */
app.get("/bootstrap", (c) => notImplemented(c));
