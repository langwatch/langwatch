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
import { createHash, createHmac, timingSafeEqual } from "crypto";

import { env } from "~/env.mjs";
import { loggerMiddleware } from "~/app/api/middleware/logger";
import { tracerMiddleware } from "~/app/api/middleware/tracer";
import { Prisma as PrismaNs } from "@prisma/client";

import { prisma } from "~/server/db";
import {
  GatewayBudgetRepository,
  type DebitLineItem,
} from "~/server/gateway/budget.repository";
import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { GatewayConfigMaterialiser } from "~/server/gateway/config.materialiser";
import { signGatewayJwt } from "~/server/gateway/gatewayJwt";
import {
  VirtualKeyCryptoError,
  hashVirtualKeySecret,
  parseVirtualKey,
} from "~/server/gateway/virtualKey.crypto";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";

export const app = new Hono().basePath("/api/internal/gateway");
app.use(tracerMiddleware({ name: "gateway-internal" }));
app.use(loggerMiddleware());

// ── auth middleware ─────────────────────────────────────────────────────

export const GATEWAY_SIGNATURE_WINDOW_SECONDS = 300;

/**
 * Build the canonical string the Go gateway signs:
 *   METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + hex(sha256(body))
 */
export function buildGatewayCanonicalString(input: {
  method: string;
  path: string;
  timestamp: string;
  body: string;
}): string {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  return `${input.method}\n${input.path}\n${input.timestamp}\n${bodyHash}`;
}

/** hex(hmac_sha256(secret, canonical)) */
export function computeGatewaySignature(
  secret: string,
  canonical: string,
): string {
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

/**
 * Verify the gateway's HMAC signature with a replay-protection timestamp.
 *
 * Canonical string:
 *   method + "\n" + path + "\n" + unix_timestamp + "\n" + hex(sha256(body))
 *
 * Headers:
 *   X-LangWatch-Gateway-Signature: hex(hmac_sha256(LW_GATEWAY_INTERNAL_SECRET, canonical))
 *   X-LangWatch-Gateway-Timestamp: unix seconds (±300s window)
 *   X-LangWatch-Gateway-Node: advisory, unsigned
 *
 * Verification order (by design — matches `services/gateway/internal/auth`):
 *   1. Missing headers → 401 (cheap check)
 *   2. Signature compare (constant-time) → 401 if bad
 *   3. Timestamp window → 401 if drifted
 *
 * Doing the HMAC compare before the timestamp check prevents timing-side
 * channels from leaking which failed (invalid sig vs. replayed request).
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

  const body = await c.req.raw.clone().text();
  const url = new URL(c.req.url);
  const canonical = buildGatewayCanonicalString({
    method: c.req.method,
    path: url.pathname,
    timestamp: presentedTs,
    body,
  });
  const expected = computeGatewaySignature(secret, canonical);

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
app.post("/resolve-key", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    key_presented?: string;
    gateway_node_id?: string;
  };
  const presented = body.key_presented;
  if (!presented || typeof presented !== "string") {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "missing_key_presented",
          message: "key_presented is required",
        },
      },
      400,
    );
  }

  try {
    parseVirtualKey(presented);
  } catch (err) {
    if (err instanceof VirtualKeyCryptoError) {
      return c.json(
        {
          error: {
            type: "invalid_api_key",
            code: err.code,
            message: err.message,
          },
        },
        401,
      );
    }
    throw err;
  }

  const hashed = hashVirtualKeySecret(presented);
  const service = VirtualKeyService.create(prisma);
  const vk = await service.getByHashedSecretInternal(hashed);
  if (!vk) {
    return c.json(
      {
        error: {
          type: "invalid_api_key",
          code: "virtual_key_not_found",
          message: "unknown virtual key",
        },
      },
      401,
    );
  }
  if (vk.status === "REVOKED") {
    return c.json(
      {
        error: {
          type: "virtual_key_revoked",
          code: "virtual_key_revoked",
          message: "virtual key has been revoked",
        },
      },
      403,
    );
  }

  const project = await prisma.project.findUnique({
    where: { id: vk.projectId },
  });
  if (!project) {
    return c.json(
      {
        error: {
          type: "internal_error",
          code: "project_orphaned",
          message: "virtual key references missing project",
        },
      },
      500,
    );
  }

  const { jwt: token } = signGatewayJwt({
    vk_id: vk.id,
    project_id: project.id,
    team_id: project.teamId,
    org_id: project.organizationId,
    principal_id: vk.principalUserId,
    revision: vk.revision.toString(),
  });

  // Fire-and-forget last-used bump. Failures here must not deny the request.
  void service.touchUsage(vk.id).catch(() => {});

  return c.json({
    jwt: token,
    revision: vk.revision.toString(),
    key_id: vk.id,
    display_prefix: vk.displayPrefix,
  });
});

/**
 * §4.2 — full warm-cache config by vk_id with `If-None-Match: <revision>`.
 * Returns 304 Not Modified when client has current revision.
 */
app.get("/config/:vk_id", async (c) => {
  const vkId = c.req.param("vk_id");
  const vk = await prisma.virtualKey.findUnique({
    where: { id: vkId },
    include: { providerCredentials: { orderBy: { priority: "asc" } } },
  });
  if (!vk) {
    return c.json(
      {
        error: {
          type: "invalid_api_key",
          code: "virtual_key_not_found",
          message: "unknown virtual key",
        },
      },
      404,
    );
  }

  const ifNoneMatch = c.req.header("If-None-Match");
  const currentRevision = vk.revision.toString();
  if (ifNoneMatch && ifNoneMatch === currentRevision) {
    return c.body(null, 304, {
      ETag: currentRevision,
      "Cache-Control": "no-store",
    });
  }

  const payload = await new GatewayConfigMaterialiser(prisma).materialise(vk);
  return c.json(payload, 200, {
    ETag: currentRevision,
    "Cache-Control": "no-store",
  });
});

/**
 * §4.3 — mutations since a given revision. Short, polite long-poll:
 * Hono isn't the right place for 25s held sockets, so we do a brief loop
 * with 2s sleeps for a maximum of ~10s per request. The Go client falls
 * straight back into the next long-poll on 204.
 *
 * Query: ?since=<revision>&timeout_s=10
 * Response: { current_revision, changes: [{kind, vk_id, revision}, ...] }
 * Returns 204 No Content when no diff within timeout.
 */
app.get("/changes", async (c) => {
  const sinceParam = c.req.query("since") ?? "0";
  const orgId = c.req.query("organization_id");
  if (!orgId) {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "missing_organization_id",
          message: "organization_id query param is required",
        },
      },
      400,
    );
  }

  let since: bigint;
  try {
    since = BigInt(sinceParam);
  } catch {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "invalid_since",
          message: "since must be an integer",
        },
      },
      400,
    );
  }

  const timeoutSeconds = Math.max(
    1,
    Math.min(25, Number.parseInt(c.req.query("timeout_s") ?? "10", 10) || 10),
  );
  const repo = new ChangeEventRepository(prisma);
  const deadline = Date.now() + timeoutSeconds * 1000;

  while (Date.now() < deadline) {
    const { events, currentRevision } = await repo.since(orgId, since, 500);
    if (events.length > 0) {
      return c.json(
        {
          current_revision: currentRevision.toString(),
          changes: events.map((e) => ({
            kind: e.kind,
            virtual_key_id: e.virtualKeyId,
            budget_id: e.budgetId,
            provider_credential_id: e.providerCredentialId,
            project_id: e.projectId,
            revision: e.revision.toString(),
          })),
        },
        200,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const current = await repo.currentRevision(orgId);
  return c.body(null, 204, {
    "X-LangWatch-Revision": current.toString(),
  });
});

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
app.post("/budget/debit", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    gateway_request_id?: string;
    vk_id?: string;
    actual_cost_usd?: number | string;
    tokens?: {
      input?: number;
      output?: number;
      cache_read?: number;
      cache_write?: number;
    };
    model?: string;
    provider_slot?: string | null;
    duration_ms?: number | null;
    status?: string;
  };

  if (!body.gateway_request_id || !body.vk_id || !body.model) {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "missing_required_fields",
          message: "gateway_request_id, vk_id, and model are required",
        },
      },
      400,
    );
  }

  const vk = await prisma.virtualKey.findUnique({
    where: { id: body.vk_id },
  });
  if (!vk) {
    return c.json(
      {
        error: {
          type: "invalid_api_key",
          code: "virtual_key_not_found",
          message: "unknown virtual key",
        },
      },
      404,
    );
  }
  const project = await prisma.project.findUnique({
    where: { id: vk.projectId },
  });
  if (!project) {
    return c.json(
      {
        error: {
          type: "internal_error",
          code: "project_orphaned",
          message: "virtual key references missing project",
        },
      },
      500,
    );
  }

  const status = normaliseDebitStatus(body.status);
  const amount = new PrismaNs.Decimal(
    typeof body.actual_cost_usd === "number"
      ? body.actual_cost_usd
      : (body.actual_cost_usd ?? 0),
  );
  const repo = new GatewayBudgetRepository(prisma);

  const lines: DebitLineItem[] = await prisma.$transaction(async (tx) => {
    const applicable = await repo.applicableForRequest(
      {
        organizationId: project.organizationId,
        teamId: project.teamId,
        projectId: project.id,
        virtualKeyId: vk.id,
        principalUserId: vk.principalUserId,
      },
      tx,
    );

    const out: DebitLineItem[] = [];
    for (const budget of applicable) {
      out.push(
        await repo.debit(
          {
            budget,
            gatewayRequestId: body.gateway_request_id!,
            virtualKeyId: vk.id,
            providerCredentialId: null,
            amountUsd: amount,
            tokensInput: body.tokens?.input ?? 0,
            tokensOutput: body.tokens?.output ?? 0,
            tokensCacheRead: body.tokens?.cache_read ?? 0,
            tokensCacheWrite: body.tokens?.cache_write ?? 0,
            model: body.model!,
            providerSlot: body.provider_slot ?? null,
            durationMs: body.duration_ms ?? null,
            status,
          },
          tx,
        ),
      );
    }
    return out;
  });

  const anyDeduped = lines.some((l) => l.deduped);
  return c.json(
    {
      deduped: anyDeduped && lines.every((l) => l.deduped),
      budgets: lines.map((l) => ({
        budget_id: l.budgetId,
        scope: l.scope.toLowerCase(),
        scope_id: l.scopeId,
        limit_usd: l.limitUsd,
        spent_usd: l.spentUsd,
        remaining_usd: l.remainingUsd,
        deduped: l.deduped,
      })),
    },
    200,
  );
});

function normaliseDebitStatus(
  raw: string | undefined,
):
  | "SUCCESS"
  | "PROVIDER_ERROR"
  | "BLOCKED_BY_GUARDRAIL"
  | "CANCELLED" {
  switch ((raw ?? "").toLowerCase()) {
    case "success":
      return "SUCCESS";
    case "provider_error":
      return "PROVIDER_ERROR";
    case "blocked_by_guardrail":
      return "BLOCKED_BY_GUARDRAIL";
    case "cancelled":
      return "CANCELLED";
    default:
      return "SUCCESS";
  }
}

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
