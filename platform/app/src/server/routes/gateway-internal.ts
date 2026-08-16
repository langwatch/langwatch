/**
 * Hono routes for internal gateway control-plane endpoints.
 *
 * Consumed only by the LangWatch AI Gateway (Go) service. All paths are
 * protected by the shared HMAC secret `LW_GATEWAY_INTERNAL_SECRET` +
 * `X-LangWatch-Gateway-Signature` header. Never expose publicly — the Helm chart
 * blocks `/api/internal` at the ingress by default, and in-cluster callers reach
 * the app through its internal Service rather than the ingress.
 *
 * Contract source of truth:
 *   specs/ai-gateway/_shared/contract.md §4 (v0.1)
 *
 * Iteration 1: route skeleton + auth middleware + contract-shaped stubs.
 * Real logic follows once the service layer for VirtualKey / Budget lands.
 */

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import { createLogger } from "@langwatch/observability";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import type { Context, Next } from "hono";
import { z } from "zod";
import { env } from "~/env.mjs";
import type { GatewayBudget } from "~/generated/prisma/client";
import { createServiceApp, internalSecret } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import {
  admitSpendWireSchema,
  confirmSpendWireSchema,
  failSpendWireSchema,
  type SpendUsage,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { GATEWAY_SPEND_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { rateSpendNanoUsd } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { bucketPeriodFloorMs } from "~/server/gateway/budgetPeriod";
import {
  attributedUserBucketScopeId,
  bucketScopeIdFor,
} from "~/server/gateway/budgetResolution.service";
import { ChangeEventRepository } from "~/server/gateway/changeEvent.repository";
import { GatewayConfigMaterialiser } from "~/server/gateway/config.materialiser";
import { signGatewayJwt } from "~/server/gateway/gatewayJwt";
import {
  GatewayGuardrailEvaluationService,
  GUARDRAIL_WIRE_DIRECTIONS,
} from "~/server/gateway/guardrailEvaluation.service";
import { traceProjectFor } from "~/server/gateway/scopeResolver";
import {
  hashVirtualKeySecret,
  parseVirtualKey,
  VirtualKeyCryptoError,
} from "~/server/gateway/virtualKey.crypto";
import { ROUTING_POLICY_SELECT } from "~/server/gateway/virtualKey.repository";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { CodexGatewayRefreshService } from "~/server/modelProviders/codexAccount.service";
import { ModelProviderRepository } from "~/server/modelProviders/modelProvider.repository";

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

/**
 * Contract 4.6. The directions are the wire vocabulary the data plane sends,
 * which is deliberately not the Prisma enum: an earlier version of this schema
 * used the storage values, so every real gateway call failed validation and the
 * data plane fell back to allowing the request.
 */
const guardrailCheckRequestSchema = z.object({
  vk_id: z.string().min(1),
  project_id: z.string().min(1),
  gateway_request_id: z.string().optional(),
  direction: z.enum(GUARDRAIL_WIRE_DIRECTIONS),
  guardrail_ids: z.array(z.string()).default([]),
  content: z
    .object({
      messages: z.unknown().optional(),
      output: z.unknown().optional(),
      chunk: z.unknown().optional(),
      tools: z.unknown().optional(),
      mcps: z.unknown().optional(),
    })
    .optional(),
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
 * §4.7: connectivity probe for the gateway's public /health endpoint.
 *
 * The Go gateway's statusprobe monitor calls this on its own clock
 * (default every 15s per gateway pod) and serves the cached verdict to
 * the status page. Riding the signed channel is the point: a 200 proves
 * not just that the app is up but that the shared HMAC secret matches,
 * the misconfig where every pod looks green while every virtual-key
 * resolve is refused. Body deliberately static; the gateway only reads
 * the status code.
 */
secured.access(gatewayPolicy()).get("/health", (c) => {
  return c.json({ status: "ok" });
});

/**
 * §4.1 — resolve a raw virtual key to a signed JWT + current revision.
 *
 * Request:  { key_presented: "vk-lw-01HZX...", gateway_node_id: "gw-eks-abc" }
 * Response: { jwt, revision, key_id, display_prefix }
 */
/** A refusal to resolve a presented key, in the contract's error shape. */
interface KeyAuthRejection {
  status: 401 | 403;
  type: string;
  code: string;
  message: string;
}

function rejectionBody(rejection: KeyAuthRejection) {
  return {
    error: {
      type: rejection.type,
      code: rejection.code,
      message: rejection.message,
    },
  };
}

/** Why the presented key does not parse, or null when it does. Anything
 *  that is not a VirtualKeyCryptoError is a bug rather than a bad
 *  credential, so it rethrows. */
function virtualKeyParseRejection(presented: string): KeyAuthRejection | null {
  try {
    parseVirtualKey(presented);
    return null;
  } catch (err) {
    if (!(err instanceof VirtualKeyCryptoError)) throw err;
    return {
      status: 401,
      type: "invalid_api_key",
      code: err.code,
      message: err.message,
    };
  }
}

/** Why a resolved key bars itself from serving, or null when it may.
 *  Each stop carries its own code: a tenant must be able to tell "we turned
 *  you off" from "your credential is wrong" from "your key ran out", and the
 *  platform's own tooling branches on this code.
 *
 *  Expiry is a date rather than a status, so it is checked here rather than
 *  read off the row's status: the key stays ACTIVE past the date, which is
 *  what keeps extending the date an ordinary edit. A key that expires now
 *  stops being resolved immediately, and a token minted before then ends at
 *  the date itself, because the mint clamps its exp to the key's expiry. */
function virtualKeyStatusRejection({
  status,
  expiresAt,
}: {
  status: string;
  expiresAt: Date | null;
}): KeyAuthRejection | null {
  if (status === "REVOKED") {
    return {
      status: 403,
      type: "virtual_key_revoked",
      code: "virtual_key_revoked",
      message: "virtual key has been revoked",
    };
  }
  if (status === "DISABLED") {
    return {
      status: 403,
      type: "virtual_key_disabled",
      code: "virtual_key_disabled",
      message:
        "virtual key is disabled; it can be re-enabled by an administrator",
    };
  }
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return {
      status: 403,
      type: "virtual_key_expired",
      code: "virtual_key_expired",
      message:
        "virtual key has expired; extend its expiration or mint a new one",
    };
  }
  return null;
}

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

  const parseRejection = virtualKeyParseRejection(presented);
  if (parseRejection) {
    logAuthDecision(c, parseRejection.code, parseRejection.status);
    return c.json(rejectionBody(parseRejection), parseRejection.status);
  }

  const service = VirtualKeyService.create(prisma);
  const vk = await service.getByHashedSecretInternal(
    hashVirtualKeySecret(presented),
  );
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
  const statusRejection = virtualKeyStatusRejection({
    status: vk.status,
    expiresAt: vk.expiresAt,
  });
  if (statusRejection) {
    logAuthDecision(c, statusRejection.code, statusRejection.status, {
      vkId: vk.id,
    });
    return c.json(rejectionBody(statusRejection), statusRejection.status);
  }

  // Where this key's traces land, read off the key. Null for a key written
  // before the destination was stored in an organization with no governance
  // project to fall back to; the gateway then skips span export rather than
  // failing the auth handshake.
  const traceProject = await traceProjectFor(prisma, vk.traceProjectId);

  // notAfter ends the token at the key's expiration date when that arrives
  // before the ordinary 15 minute TTL, and travels on as the vk_expires_at
  // claim. Without it the gateway holds a token that outlives the key, and its
  // auth cache keeps serving that key while the control plane is unreachable.
  const { jwt } = signGatewayJwt({
    vk_id: vk.id,
    project_id: traceProject?.id ?? null,
    team_id: traceProject?.teamId ?? null,
    org_id: vk.organizationId,
    principal_id: vk.principalUserId,
    revision: vk.revision.toString(),
    notAfter: vk.expiresAt,
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
 * Codex token refresh — the gateway's recovery road for a 401 from OpenAI's
 * codex backend. Refreshes the provider row's stored OAuth session (single
 * issuer round-trip under concurrent 401 bursts — see the service) and hands
 * back a fresh access token; a dead session comes back as
 * `codex_session_expired`, which the gateway forwards so Langy can render
 * the re-authenticate card. Spec:
 * specs/model-providers/codex-account-provider.feature
 *
 * Request:  { provider_row_id }
 * Response: { access_token, account_id } | error codex_session_expired /
 *           codex_not_connected
 */
secured.access(gatewayPolicy()).post("/codex/refresh", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    provider_row_id?: string;
  };
  if (!body.provider_row_id || typeof body.provider_row_id !== "string") {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "missing_provider_row_id",
          message: "provider_row_id is required",
        },
      },
      400,
    );
  }
  const service = new CodexGatewayRefreshService(
    new ModelProviderRepository(prisma),
    new ChangeEventRepository(prisma),
  );
  const result = await service.refreshForGateway(body.provider_row_id);
  if (result.status === "not_connected") {
    return c.json(
      {
        error: {
          type: "codex_not_connected",
          code: "codex_not_connected",
          message: "no connected Codex account on this provider",
        },
      },
      404,
    );
  }
  if (result.status === "session_expired") {
    logger.warn(
      { providerRowId: body.provider_row_id },
      "codex session expired; user must sign in again",
    );
    return c.json(
      {
        error: {
          type: "codex_session_expired",
          code: "codex_session_expired",
          message: "OpenAI session expired; sign in to Codex again",
        },
      },
      401,
    );
  }
  return c.json({
    access_token: result.accessToken,
    account_id: result.accountId,
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
    include: {
      scopes: true,
      // The routing policy is where model_aliases and policy_rules live.
      // Without it the materialiser reads an absent relation and emits an
      // empty alias map plus empty deny/allow lists, so the gateway never
      // resolves an alias and never enforces a model deny rule.
      routingPolicy: { select: ROUTING_POLICY_SELECT },
    },
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

  // EC4 — the CH repo lets the materialiser stamp current-period spend
  // (sumMerge from the rollup) onto each applicable budget. The gateway's
  // existing Bundle.Config.Budget.Scopes.SpentMicroUSD -> Precheck path
  // then sees fresh state on every re-materialise after a BUDGET_UPDATED
  // eviction. Without this the wire output reads the stale
  // `GatewayBudget.spentUsd` PG column that no writer updates.
  const payload = await new GatewayConfigMaterialiser(
    prisma,
    getApp().gateway.budgets ?? null,
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

// §4.5: `/budget/debit` is removed. Cost recording rides the spend
// commands the gateway posts below: the debits process manager
// (platform/app/ee/governance/process-manager/gatewayDebits.process.ts) joins
// each request's admission to its outcome and writes the ClickHouse
// `gateway_budget_ledger_events` table, once per applicable budget. Single
// source of truth, no PG dual-write. See the migration
// 00017_create_gateway_budget_ledger.sql for the CH schema.

/**
 * §4.6 — inline guardrail pipeline.
 *
 * Request:  { vk_id, project_id, direction, guardrail_ids, content, metadata }
 * Response: { decision: allow|block|modify, reason, modified_content, policies_triggered }
 *
 * Runs every guardrail the virtual key references for this direction in
 * parallel and aggregates them: any block blocks. A guardrail whose evaluator
 * cannot produce a verdict falls to its own failure mode rather than passing,
 * so a broken evaluator cannot quietly disable an active protection.
 *
 * project_id is required. It scopes the guardrail lookup, which is what stops
 * one project's key from naming another project's guardrail. A key with no
 * trace project materialises no guardrails, so the data plane never reaches
 * this endpoint for one.
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
  const verdict = await GatewayGuardrailEvaluationService.create(prisma).check({
    projectId: parsed.data.project_id,
    guardrailIds: parsed.data.guardrail_ids,
    direction: parsed.data.direction,
    content: parsed.data.content,
  });
  if (verdict.decision !== "allow") {
    logger.info(
      {
        vkId: parsed.data.vk_id,
        projectId: parsed.data.project_id,
        direction: parsed.data.direction,
        decision: verdict.decision,
        policiesTriggered: verdict.policies_triggered,
      },
      "guardrail check did not allow the request",
    );
  }
  return c.json(verdict);
});

/**
 * §9 — startup bootstrap. Paginated stream of all non-revoked VK JWTs so the
 * gateway can serve traffic if the control-plane is offline on cold start.
 * Enterprise opt-in (env `LW_GATEWAY_BOOTSTRAP_PULL=true` on gateway side).
 *
 * Query: ?cursor=<opaque>&limit=1000
 * Response: { jwts: [...], next_cursor: null | string, current_revision }
 */

// ── attributed-user bucket spend ────────────────────────────────────────

/**
 * Per-bucket spend read for ATTRIBUTED_USER templates. The bundle carries
 * the template entry only (per-user cardinality is unbounded), so the
 * gateway resolves the request's own bucket here, caches it briefly, and
 * enforces against the returned figure. The read honors the template's
 * period boundary and any single-bucket boundary from a per-user reset:
 * whichever is later bounds the sum.
 */
/** Spend in one budget bucket, in micro USD. An organization with no
 *  projects has nothing to read, so it reports zero. */
async function bucketSpentMicroUsd(params: {
  budgetRepository: GatewayBudgetClickHouseRepository;
  budget: GatewayBudget;
  bucketScopeId: string;
  periodFloorMs: number | undefined;
}): Promise<number> {
  const projects = await prisma.project.findMany({
    where: { team: { organizationId: params.budget.organizationId } },
    select: { id: true },
  });
  if (projects.length === 0) return 0;
  const spends = await params.budgetRepository.getSpendForTargetsAcrossTenants(
    projects.map((p) => p.id),
    [
      {
        budgetId: params.budget.id,
        scope: params.budget.scopeType,
        scopeId: params.bucketScopeId,
        window: params.budget.window,
        match: "exact",
        periodFloorMs: params.periodFloorMs,
      },
    ],
  );
  const spentUsd = Number.parseFloat(spends[0]?.spentUsd ?? "0") || 0;
  return Math.round(spentUsd * 1_000_000);
}

secured.access(gatewayPolicy()).get("/budget-bucket-spend", async (c) => {
  const budgetId = c.req.query("budget_id") ?? "";
  const endUserId = c.req.query("end_user_id") ?? "";
  if (!budgetId || !endUserId) {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "missing_parameter",
          message: "budget_id and end_user_id are required",
        },
      },
      400,
    );
  }
  const budget = await prisma.gatewayBudget.findUnique({
    where: { id: budgetId },
  });
  if (!budget || budget.archivedAt || budget.scopeType !== "ATTRIBUTED_USER") {
    return c.json(
      {
        error: {
          type: "not_found",
          code: "budget_not_found",
          message: "unknown attributed-user budget",
        },
      },
      404,
    );
  }
  const budgetRepository = getApp().gateway.budgets;
  if (!budgetRepository) {
    // Without the ledger there is no bucket figure; report zero spend so
    // enforcement stays permissive rather than inventing a number.
    return c.json({ spent_micro_usd: 0, bucket: null });
  }
  const bucketScopeId = bucketScopeIdFor(
    budget,
    attributedUserBucketScopeId(budget.scopeId, endUserId),
  );
  const boundary = await prisma.gatewayBudgetBucketBoundary.findUnique({
    where: { budgetId_bucketScopeId: { budgetId: budget.id, bucketScopeId } },
    select: { periodStartedAt: true },
  });
  const spentMicroUsd = await bucketSpentMicroUsd({
    budgetRepository,
    budget,
    bucketScopeId,
    periodFloorMs: bucketPeriodFloorMs(budget, boundary?.periodStartedAt),
  });
  return c.json({ spent_micro_usd: spentMicroUsd, bucket: bucketScopeId });
});

// ── spend command ingest (spend-command spine) ──────────────────────────

const spendCommandWireSchema = z.object({
  command: z.enum(["admitSpend", "confirmSpend", "failSpend"]),
  /** The spine-spec event payload; project_id on the wire maps to the
   *  internal tenantId. Validated per command type below. */
  payload: z.record(z.string(), z.unknown()),
  pod_id: z.string().max(128).default(""),
  pod_seq: z.number().int().min(0).default(0),
});

const spendCommandBatchSchema = z.object({
  records: z.array(spendCommandWireSchema).min(1).max(500),
});

type SpendCommandName = z.infer<typeof spendCommandWireSchema>["command"];
type SpendCommandRecord = z.infer<typeof spendCommandWireSchema>;

const SPEND_COMMAND_NAMES = [
  "admitSpend",
  "confirmSpend",
  "failSpend",
] as const;

const SPEND_COMMAND_SCHEMAS = {
  admitSpend: admitSpendWireSchema,
  confirmSpend: confirmSpendWireSchema,
  failSpend: failSpendWireSchema,
} as const;

interface SpendCommandReject {
  code: string;
  message: string;
  issues?: unknown[];
}

/** The gateway-spend pipeline, or undefined when event sourcing is not
 *  registered (ClickHouse disabled). */
function spendPipeline() {
  try {
    return getApp().eventSourcing?.getPipeline(GATEWAY_SPEND_PIPELINE_NAME);
  } catch {
    return undefined;
  }
}

/**
 * The single seam that prices a gateway outcome. The wire carries
 * quantities, never money, so the server rates here, once, and the
 * appended event carries the figure from then on: the fold, the
 * attributed-user debits, and the webhook envelope all copy it instead of
 * each pricing the same request at its own instant against a model
 * catalog that moves under them.
 *
 * The gateway always names a model on an outcome (the resolved identity
 * once dispatch settled it, the requested one before that), which is the
 * identity the ledger stores for the request.
 */
function pricedOutcomeData(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const outcome = data as unknown as {
    model: string;
    usage: SpendUsage;
    rate_version?: string;
  };
  const rated = rateSpendNanoUsd({
    model: outcome.model,
    usage: outcome.usage,
    rateVersion: outcome.rate_version,
  });
  return {
    ...data,
    cost_nano_usd: rated.costNanoUsd,
    rate_version: rated.rateVersion,
  };
}

/** The internal command data one wire record maps to, or why it cannot be
 *  accepted. `project_id` on the wire is the internal `tenantId`; only
 *  admits carry the pod identity the gap detector reads, and outcomes are
 *  priced on the way through. */
function toSpendCommandData(
  record: SpendCommandRecord,
):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; reject: SpendCommandReject } {
  const wire = record.payload;
  const projectId = wire.project_id;
  if (typeof projectId !== "string" || projectId.length === 0) {
    return {
      ok: false,
      reject: {
        code: "missing_project_id",
        message: "spend command record rejected: missing project_id",
      },
    };
  }
  const { project_id: _projectId, ...rest } = wire;
  const mapped: Record<string, unknown> =
    record.command === "admitSpend"
      ? {
          ...rest,
          tenantId: projectId,
          pod_id: record.pod_id,
          pod_seq: record.pod_seq,
        }
      : { ...rest, tenantId: projectId };
  const validated = SPEND_COMMAND_SCHEMAS[record.command].safeParse(mapped);
  if (!validated.success) {
    return {
      ok: false,
      reject: {
        code: "invalid_payload",
        message: "spend command record rejected",
        issues: validated.error.issues.slice(0, 3),
      },
    };
  }
  const data = validated.data as Record<string, unknown>;
  return {
    ok: true,
    data: record.command === "admitSpend" ? data : pricedOutcomeData(data),
  };
}

/** The wire fields that identify a rejected record, so the log line can be
 *  reconciled against the gateway's own. Read defensively: a record is only
 *  rejected because its payload did not hold up. */
function rejectedRecordIdentity(
  record: SpendCommandRecord,
): Record<string, string | null> {
  const wireString = (key: string): string | null => {
    const value = record.payload[key];
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  return {
    gatewayRequestId: wireString("gateway_request_id"),
    tenantId: wireString("project_id"),
  };
}

/** Group the batch by command, reporting unacceptable records by index.
 *  Every reject path logs: a silent per-record drop looks like a healthy
 *  200 from the emitter's side and loses billing records. */
function groupSpendCommands(records: SpendCommandRecord[]): {
  perCommand: Record<SpendCommandName, Array<Record<string, unknown>>>;
  rejected: Array<{ index: number; code: string }>;
} {
  const perCommand: Record<SpendCommandName, Array<Record<string, unknown>>> = {
    admitSpend: [],
    confirmSpend: [],
    failSpend: [],
  };
  const rejected: Array<{ index: number; code: string }> = [];
  records.forEach((record, index) => {
    const mapped = toSpendCommandData(record);
    if (!mapped.ok) {
      rejected.push({ index, code: mapped.reject.code });
      // Error, not warn: the drainer reads a 200 and acks the segment, so this
      // line is the only trace the record ever existed. It names the request
      // because "a record was rejected" cannot be reconciled against anything.
      logger.error(
        {
          command: record.command,
          index,
          code: mapped.reject.code,
          ...rejectedRecordIdentity(record),
          ...(mapped.reject.issues ? { issues: mapped.reject.issues } : {}),
        },
        mapped.reject.message,
      );
      return;
    }
    perCommand[record.command].push(mapped.data);
  });
  return { perCommand, rejected };
}

/** How stale `lastUsedAt` has to be before a drain batch advances it.
 *  Admin oversight reads the column on minute scale, so writing it per
 *  request would buy nothing. */
const VIRTUAL_KEY_TOUCH_THROTTLE_MS = 60_000;

/** The key row an admission is attributed against. */
type AttributionVirtualKey = {
  id: string;
  organizationId: string;
  principalUserId: string | null;
  lastUsedAt: Date | null;
};

/** The ids an admit record was validated with. Every one of them is a
 *  required field on the wire schema, so these reads are total. */
function admitIdentity(admit: Record<string, unknown>): {
  gatewayRequestId: string;
  virtualKeyId: string;
  projectId: string;
  organizationId: string;
} {
  return {
    gatewayRequestId: String(admit.gateway_request_id ?? ""),
    virtualKeyId: String(admit.virtual_key_id ?? ""),
    projectId: String(admit.tenantId ?? ""),
    organizationId: String(admit.organization_id ?? ""),
  };
}

/**
 * Advance `lastUsedAt` on the keys this batch admitted.
 *
 * Admission is the one moment that sees every kind of use: the requests the
 * gateway went on to block over a budget or a guardrail, and the ones whose
 * outcome never arrives, are all admitted first. One conditional write per
 * drain batch, decided off the rows the enrichment already read, and a batch
 * whose keys were all touched recently writes nothing.
 *
 * Best effort: the column is oversight, not enforcement, and failing the
 * batch over it would cost the drainer a retry of records that appended.
 */
async function touchAdmittedVirtualKeys(
  virtualKeys: AttributionVirtualKey[],
  now: Date,
): Promise<void> {
  const staleIds = virtualKeys
    .filter(
      (vk) =>
        !vk.lastUsedAt ||
        now.getTime() - vk.lastUsedAt.getTime() > VIRTUAL_KEY_TOUCH_THROTTLE_MS,
    )
    .map((vk) => vk.id);
  if (staleIds.length === 0) return;
  try {
    await prisma.virtualKey.updateMany({
      where: { id: { in: staleIds } },
      data: { lastUsedAt: now },
    });
  } catch (error) {
    logger.warn(
      { virtualKeyIds: staleIds, error },
      "failed to advance virtualKey.lastUsedAt for admitted spend commands",
    );
  }
}

/**
 * Join every admission to the attribution the gateway cannot see: the key's
 * principal and the tenant project's team. Two batched reads answer for a
 * whole batch of up to 500 records, and the appended event carries the
 * result from then on, so nothing downstream re-reads identity per request.
 *
 * The two ways this can come up short are deliberately not treated alike. A
 * MISSING row (a key deleted between dispatch and drain, a project without a
 * team) is a fact about the world: that one record degrades to empty
 * attribution, still owes its organization, project and key debits, and logs
 * the ids so the team, principal and group budgets it skipped can be
 * reconciled from the log. A prisma FAILURE is not a fact, it is an unknown,
 * and an event is immutable once appended, so it propagates to a 500 and the
 * drainer retries the whole batch.
 */
async function enrichAdmitCommands(
  admits: Array<Record<string, unknown>>,
): Promise<void> {
  if (admits.length === 0) return;
  const identities = admits.map(admitIdentity);
  const [virtualKeys, projects] = await Promise.all([
    prisma.virtualKey.findMany({
      where: {
        id: { in: [...new Set(identities.map((i) => i.virtualKeyId))] },
      },
      select: {
        id: true,
        organizationId: true,
        principalUserId: true,
        lastUsedAt: true,
      },
    }),
    prisma.project.findMany({
      where: { id: { in: [...new Set(identities.map((i) => i.projectId))] } },
      select: { id: true, teamId: true },
    }),
  ]);
  const keyById = new Map(virtualKeys.map((vk) => [vk.id, vk]));
  const teamIdByProject = new Map(projects.map((p) => [p.id, p.teamId]));

  admits.forEach((admit, index) => {
    const identity = identities[index]!;
    const key = keyById.get(identity.virtualKeyId);
    const teamId = teamIdByProject.get(identity.projectId) ?? "";
    if (!key) {
      logger.error(
        identity,
        "spend admission names a virtual key that no longer exists: principal and group budgets will not see this request",
      );
    } else if (key.organizationId !== identity.organizationId) {
      // Logged, not dropped. The record is already durable on the gateway's
      // side, and a discarded admission loses the outcome that follows it;
      // the mismatch is a control-plane inconsistency to chase, not a reason
      // to lose billing evidence.
      logger.error(
        { ...identity, keyOrganizationId: key.organizationId },
        "spend admission names a virtual key from another organization",
      );
    }
    if (!teamId) {
      logger.error(
        identity,
        "spend admission names a project with no team: team budgets will not see this request",
      );
    }
    admit.principal_user_id = key?.principalUserId ?? "";
    admit.team_id = teamId;
  });

  await touchAdmittedVirtualKeys(virtualKeys, new Date());
}

interface SpendCommandSender {
  sendBatch?: (payloads: unknown[]) => Promise<unknown>;
  send: (payload: unknown) => Promise<unknown>;
}

/** Hand each command's group to the pipeline, preferring the batched
 *  sender where the command exposes one. Answers the command whose sender
 *  is missing, which is a registration bug the caller reports as a 503. */
async function sendSpendCommands(
  commands: unknown,
  perCommand: Record<SpendCommandName, Array<Record<string, unknown>>>,
): Promise<SpendCommandName | null> {
  const senders = commands as Record<string, SpendCommandSender | undefined>;
  for (const name of SPEND_COMMAND_NAMES) {
    const batch = perCommand[name];
    if (batch.length === 0) continue;
    const sender = senders[name];
    if (!sender) return name;
    if (sender.sendBatch) {
      await sender.sendBatch(batch);
      continue;
    }
    for (const payloadItem of batch) {
      await sender.send(payloadItem);
    }
  }
  return null;
}

/**
 * Async spend-command ingest. The gateway's drainer posts spooled batches
 * here at-least-once; every command carries a per-(request, step)
 * idempotency key at the event store, so redelivery is a no-op and the
 * drainer can retry the whole batch safely.
 *
 * Per-record acceptance: one malformed record must not wedge the spool
 * (the drainer would retry a permanently rejected batch forever), so bad
 * records are reported back by index and the rest append. The gateway
 * counts rejects; a nonzero rate is a contract bug, and a rejected outcome
 * still surfaces later when settlement flags the admission for
 * reconciliation (the pod-seq gap detector only covers admits).
 *
 * Admissions are enriched before they append, which is the one thing here
 * that can fail the whole batch: attribution the gateway cannot see has to
 * be right on an immutable event, so an unreadable database answers 500 and
 * lets the drainer come back rather than appending a guess.
 */
secured.access(gatewayPolicy()).post("/spend-commands", async (c) => {
  const parsed = spendCommandBatchSchema.safeParse(
    await c.req.json().catch(() => null),
  );
  if (!parsed.success) {
    return c.json(
      {
        error: {
          type: "bad_request",
          code: "invalid_batch",
          message: "records[] of {command, payload, pod_id, pod_seq} required",
        },
      },
      400,
    );
  }

  const pipeline = spendPipeline();
  if (!pipeline) {
    return c.json(
      {
        error: {
          type: "unavailable",
          code: "spend_pipeline_disabled",
          message:
            "gateway spend pipeline is not registered (ClickHouse disabled)",
        },
      },
      503,
    );
  }

  const { perCommand, rejected } = groupSpendCommands(parsed.data.records);

  await enrichAdmitCommands(perCommand.admitSpend);

  const unregistered = await sendSpendCommands(pipeline.commands, perCommand);
  if (unregistered) {
    return c.json(
      {
        error: {
          type: "unavailable",
          code: "spend_command_missing",
          message: `command ${unregistered} is not registered`,
        },
      },
      503,
    );
  }

  return c.json({
    accepted: parsed.data.records.length - rejected.length,
    rejected,
  });
});

secured.access(gatewayPolicy()).get("/bootstrap", (c) => notImplemented(c));

export const app = secured.hono;
