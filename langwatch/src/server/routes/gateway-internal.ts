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

import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { Context, Next } from "hono";
import { z } from "zod";

import { env } from "~/env.mjs";
import { createServiceApp, internalSecret } from "~/server/api/security";
import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";

import { prisma } from "~/server/db";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { GatewayConfigMaterialiser } from "~/server/gateway/config.materialiser";
import { signGatewayJwt } from "~/server/gateway/gatewayJwt";
import { resolveTraceProject } from "~/server/gateway/scopeResolver";
import {
  hashVirtualKeySecret,
  parseVirtualKey,
  VirtualKeyCryptoError,
} from "~/server/gateway/virtualKey.crypto";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { createLogger } from "~/utils/logger/server";

// `verifySecret` applies the HMAC verifier as the builder chain for every
// route (uniform with `files/.../app.ts`), rather than an app-wide
// `secured.use(...)`. `verifyGatewaySignature` is hoisted (function decl).
const secured = createServiceApp({
  basePath: "/api/internal/gateway",
  verifySecret: verifyGatewaySignature,
});

const gatewayPolicy = () =>
  internalSecret(
    "gateway HMAC signature verified by the verifySecret chain (verifyGatewaySignature)",
  );

const logger = createLogger("langwatch:gateway-internal");

const guardrailCheckRequestSchema = z.object({
  vk_id: z.string().min(1),
  direction: z.enum(["pre", "post", "stream_chunk"]),
  guardrail_ids: z.array(z.string()).default([]),
  content: z.unknown().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

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
/**
 * Emit the auth-decision code at WARN level so the generic
 * loggerMiddleware's `status=401` line gets a sibling that names
 * the specific reason (missing_signature / invalid_signature /
 * timestamp_out_of_window / virtual_key_not_found / ...). Without
 * this, a dogfooder seeing 401 in the api log has to guess between
 * five paths since the response body isn't echoed by the request
 * logger. Includes the gateway node ID when present so multi-node
 * deployments can correlate which gateway sent the bad request.
 */
function logAuthDecision(
  c: Context,
  code: string,
  status: number,
  detail?: Record<string, unknown>,
): void {
  logger.warn(
    {
      code,
      status,
      path: new URL(c.req.url).pathname,
      gatewayNodeId: c.req.header("X-LangWatch-Gateway-Node") ?? null,
      ...detail,
    },
    `gateway-internal auth: ${code}`,
  );
}

async function verifyGatewaySignature(c: Context, next: Next) {
  const secret =
    process.env.LW_GATEWAY_INTERNAL_SECRET ?? env.LW_GATEWAY_INTERNAL_SECRET;
  if (!secret) {
    logAuthDecision(c, "gateway_internal_secret_missing", 500);
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
    logAuthDecision(c, "missing_signature", 401, {
      hasSignature: Boolean(presentedSig),
      hasTimestamp: Boolean(presentedTs),
    });
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
    logAuthDecision(c, "invalid_signature", 401);
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
    logAuthDecision(c, "invalid_timestamp", 401, { presentedTs });
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
    logAuthDecision(c, "timestamp_out_of_window", 401, {
      driftSeconds: now - ts,
    });
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
 * Request:  { key_presented: "vk-lw-01HZX...", gateway_node_id: "gw-eks-abc" }
 * Response: { jwt, revision, key_id, display_prefix }
 */
secured.access(gatewayPolicy()).post("/resolve-key", async (c) => {
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
      logAuthDecision(c, err.code, 401);
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
    logAuthDecision(c, "virtual_key_not_found", 401);
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
    logAuthDecision(c, "virtual_key_revoked", 403, { vkId: vk.id });
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

  // Resolve the trace project for OTLP routing. PROJECT-scoped VK with
  // exactly one PROJECT scope -> that project; otherwise -> the org's
  // `internal_governance` project; otherwise -> null (gateway skips
  // span export rather than failing the auth handshake).
  const traceProject = await resolveTraceProject(prisma, vk);

  const { jwt } = signGatewayJwt({
    vk_id: vk.id,
    project_id: traceProject?.id ?? null,
    team_id: traceProject?.teamId ?? null,
    org_id: vk.organizationId,
    principal_id: vk.principalUserId,
    revision: vk.revision.toString(),
  });

  // Fire-and-forget last-used bump. Failures here must not deny the request.
  void service.touchUsage(vk.id).catch(() => {});

  return c.json({
    jwt,
    revision: vk.revision.toString(),
    key_id: vk.id,
    display_prefix: vk.displayPrefix,
  });
});

/**
 * §4.2 — full warm-cache config by vk_id with `If-None-Match: <revision>`.
 * Returns 304 Not Modified when client has current revision.
 */
secured.access(gatewayPolicy()).get("/config/:vk_id", async (c) => {
  const vkId = c.req.param("vk_id");
  const vk = await prisma.virtualKey.findUnique({
    where: { id: vkId },
    include: { scopes: true },
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

  // EC4 — wire the CH repo so the materialiser stamps current-period
  // spend (sumMerge from the rollup) onto each applicable budget. The
  // gateway's existing Bundle.Config.Budget.Scopes.SpentMicroUSD ->
  // Precheck path then sees fresh state on every re-materialise after
  // a BUDGET_UPDATED eviction. Without this the wire output reads the
  // stale `GatewayBudget.spentUsd` PG column that no writer updates.
  const chRepo = isClickHouseEnabled()
    ? new GatewayBudgetClickHouseRepository(async (projectId) => {
        const client = await getClickHouseClientForProject(projectId);
        if (!client) {
          throw new Error(
            `ClickHouse enabled but no client for project ${projectId}`,
          );
        }
        return client;
      })
    : null;
  const payload = await new GatewayConfigMaterialiser(
    prisma,
    chRepo,
  ).materialise(vk);
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
secured.access(gatewayPolicy()).get("/changes", async (c) => {
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
            model_provider_id: e.modelProviderId,
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
secured.access(gatewayPolicy()).post("/budget/check", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    vk_id?: string;
    gateway_request_id?: string;
    projected_cost_usd?: number | string;
    model?: string;
  };
  if (!body.vk_id || body.projected_cost_usd === undefined) {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "missing_required_fields",
          message: "vk_id and projected_cost_usd are required",
        },
      },
      400,
    );
  }

  const vk = await prisma.virtualKey.findUnique({
    where: { id: body.vk_id },
    include: { scopes: true },
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
  // Trace project resolution mirrors the /config/:vk_id and /resolve-key
  // paths: single-PROJECT-scope VK uses that project; otherwise fall
  // back to the org's internal_governance project; otherwise null —
  // budget check still runs against ORG/VIRTUAL_KEY/PRINCIPAL scopes.
  const traceProject = await resolveTraceProject(prisma, vk);

  // EC6 — admin oversight ("when did this user last use their VK")
  // was broken because /resolve-key only fires on bundle cache miss
  // (~once per JWT TTL = 15 min). The gateway hits /budget/check on
  // every dispatch, so this is the right hook for last-used updates.
  // Throttle to 60s to avoid hot-row contention at high RPS — admin
  // dashboards refresh on minute-scale anyway. Fire-and-forget so a
  // DB blip doesn't deny the request.
  if (!vk.lastUsedAt || Date.now() - vk.lastUsedAt.getTime() > 60 * 1000) {
    const vkService = VirtualKeyService.create(prisma);
    void vkService.touchUsage(vk.id).catch(() => {});
  }

  const service = GatewayBudgetService.create(
    prisma,
    isClickHouseEnabled()
      ? new GatewayBudgetClickHouseRepository(async (projectId) => {
          const client = await getClickHouseClientForProject(projectId);
          if (!client) {
            throw new Error(
              `ClickHouse enabled but no client for project ${projectId}`,
            );
          }
          return client;
        })
      : undefined,
  );
  const result = await service.check({
    organizationId: vk.organizationId,
    teamId: traceProject?.teamId ?? null,
    projectId: traceProject?.id ?? null,
    virtualKeyId: vk.id,
    principalUserId: vk.principalUserId,
    projectedCostUsd: body.projected_cost_usd,
  });

  return c.json(
    {
      decision: result.decision,
      warnings: result.warnings.map((w) => ({
        scope: w.scope,
        pct_used: w.pctUsed,
        limit_usd: w.limitUsd,
      })),
      block_reason: result.blockReason,
      blocked_by: result.blockedBy.map((b) => ({
        budget_id: b.budgetId,
        scope: b.scope,
        scope_id: b.scopeId,
        window: b.window,
        limit_usd: b.limitUsd,
        spent_usd: b.spentUsd,
      })),
      // Contract §4.4 — raw per-scope ledger consumed by the gateway's
      // Checker.ApplyLive reconciliation path. Includes every applicable
      // budget, not just the ones in warn/block.
      scopes: result.scopes.map((s) => ({
        scope: s.scope,
        scope_id: s.scopeId,
        window: s.window,
        spent_usd: s.spentUsd,
        limit_usd: s.limitUsd,
      })),
    },
    200,
  );
});

// §4.5 — `/budget/debit` is removed. Cost recording is now driven by the
// trace-fold reactor on the trace-processing pipeline
// (langwatch/src/server/event-sourcing/pipelines/trace-processing/reactors/
// gatewayBudgetSync.reactor.ts), which folds OTel span usage attributes
// into the ClickHouse `gateway_budget_ledger_events` table. Single source
// of truth, no PG dual-write — see CLAUDE.md & the migration
// 00017_create_gateway_budget_ledger.sql for the CH schema.

/**
 * §4.6 — inline guardrail pipeline.
 *
 * Request:  { vk_id, direction, guardrail_ids, content, metadata }
 * Response: { decision: allow|block|modify, reason, modified_content, policies_triggered }
 *
 * Current implementation is a plumbing stub: validates the request shape,
 * returns `allow` with no policies triggered, and logs so the Go gateway can
 * exercise the full control-plane round-trip while real evaluator wiring
 * lands. When the langwatch/langwatch_nlp evaluator SDK is connected here,
 * this body swaps for a parallel fan-out with first-block short-circuit
 * (contract §4.6, and @sergey's iter 3 gateway-side fan-out mirrors this
 * contract).
 */
secured.access(gatewayPolicy()).post("/guardrail/check", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "invalid_json",
          message: "guardrail/check requires a JSON body",
        },
      },
      400,
    );
  }
  const parsed = guardrailCheckRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "validation_error",
          message: parsed.error.message,
        },
      },
      400,
    );
  }
  logger.info(
    {
      vkId: parsed.data.vk_id,
      direction: parsed.data.direction,
      guardrailIds: parsed.data.guardrail_ids,
    },
    "guardrail/check plumbing stub — returning allow",
  );
  return c.json({
    decision: "allow" as const,
    reason: null,
    modified_content: null,
    policies_triggered: [],
  });
});

/**
 * §9 — startup bootstrap. Paginated stream of all non-revoked VK JWTs so the
 * gateway can serve traffic if the control-plane is offline on cold start.
 * Enterprise opt-in (env `LW_GATEWAY_BOOTSTRAP_PULL=true` on gateway side).
 *
 * Query: ?cursor=<opaque>&limit=1000
 * Response: { jwts: [...], next_cursor: null | string, current_revision }
 */
secured.access(gatewayPolicy()).get("/bootstrap", (c) => notImplemented(c));

export const app = secured.hono;
