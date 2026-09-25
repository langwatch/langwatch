/**
 * `/api/internal/gateway`: control plane between the two halves of one
 * deployment. Every route answers behind {@link GatewayInternalIdentityService}'s
 * HMAC gate; each capability is OPTIONAL, refusing (503) rather than silent.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import { defineRestRouter, MANAGEMENT_API_VERSION } from "@langwatch/api/rest";
import {
  gatewayInternalHeadersSchema,
  gatewayInternalChangesQuerySchema,
  gatewayInternalBucketQuerySchema,
  gatewayInternalCodexRefreshSchema,
  gatewayInternalConfigParamsSchema,
  gatewayInternalGuardrailCheckSchema,
  gatewayInternalPatchSessionSchema,
  gatewayInternalReportUsageSchema,
  gatewayInternalReserveSessionSchema,
  gatewayInternalResolveKeySchema,
  gatewayInternalSessionParamsSchema,
  gatewayInternalSpendCommandBatchSchema,
  GatewayApi,
  gatewayInternalHealthAnswers,
  gatewayInternalResolveKeyAnswers,
  gatewayInternalCodexRefreshAnswers,
  gatewayInternalConfigAnswers,
  gatewayInternalChangesAnswers,
  gatewayInternalGuardrailAnswers,
  gatewayInternalBucketSpendAnswers,
  gatewayInternalSpendCommandsAnswers,
  gatewayInternalReserveSessionAnswers,
  gatewayInternalPatchSessionAnswers,
  gatewayInternalReportUsageAnswers,
  gatewayInternalBootstrapAnswers,
  type GatewayLicenseTokenRefusal,
  type GatewayVirtualKeyRecord,
  LICENSE_TOKEN_PREFIX,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { resolveRequestBound } from "@langwatch/plans";
import { nowInstant, type Instant } from "@langwatch/time";

import { GatewayAuthDecisionService } from "../services/gateway-auth-decision.service.ts";
import {
  VirtualKeyCryptoService,
  VirtualKeyCryptoError,
} from "../services/virtual-key-crypto.service.ts";

const logger = createLogger("langwatch:gateway-internal");
const authDecisions = GatewayAuthDecisionService.create({ logger });

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

const PRODUCES_JSON = "application/json";

/**
 * Why these routes declare no credential the framework resolves. The whole gate
 * is the family's own HMAC, applied under its paths before any route.
 */
const GATEWAY_INTERNAL_GATE =
  "the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs";

// ── the family's own answers ────────────────────────────────────────────

function answer<const Body>(body: Body) {
  return { status: 200 as const, body };
}

function refuse<Status extends 400 | 401 | 403 | 404 | 429 | 501 | 503>(
  status: Status,
  error: { type: string; code: string; message: string } & Record<string, unknown>,
) {
  return { status, body: { error } };
}

/** 503 when no session store: the gateway must refuse the mint, not book an unbilled call. */
const realtimeSessionsUnavailable = () =>
  refuse(503, {
    type: "unavailable",
    code: "realtime_sessions_unavailable",
    message: "this deployment composes no realtime voice session store",
  });

/** The body a route reads for itself, or `null` when the bytes were not JSON. */
function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── the family's own door ───────────────────────────────────────────────

/** How each license-token refusal reads on the wire, exactly as main answered it. */
const LICENSE_TOKEN_REFUSALS: Record<
  GatewayLicenseTokenRefusal,
  { status: 400 | 401 | 403; message: string }
> = {
  connect_license_token_malformed: { status: 401, message: "the license token is malformed" },
  connect_instance_required: {
    status: 400,
    message: "a license token must be presented with an instance id",
  },
  connect_license_not_registered: {
    status: 401,
    message: "this license is not registered for hosted services",
  },
  connect_license_revoked: { status: 403, message: "this license is no longer active" },
  connect_license_expired: { status: 403, message: "this license has expired" },
  connect_wrong_instance: { status: 403, message: "this license is bound to another instance" },
};

/**
 * Signs for a key that may serve. `notAfter` ends the token at the key's (or the
 * license's) end when that comes before the 15 minute TTL, so an auth cache never
 * outlives the key; a license's services travel as the `connect_services` claim.
 */
async function keyResolution(
  app: GatewayApi,
  {
    vk,
    notAfter,
    connectServices,
  }: { vk: GatewayVirtualKeyRecord; notAfter: Instant | null; connectServices?: string[] },
) {
  // Null for a key written before the destination was stored, in an organization
  // with no governance project: the gateway then skips span export instead.
  const traceProject = vk.traceProjectId ? await app.findTraceDestination(vk.traceProjectId) : null;
  const { jwt } = app.signJwt({
    vk_id: vk.id,
    project_id: traceProject?.id ?? null,
    team_id: traceProject?.teamId ?? null,
    org_id: vk.organizationId,
    principal_id: vk.principalUserId,
    revision: vk.revision.toString(),
    notAfter,
    ...(connectServices ? { connect_services: connectServices } : {}),
  });
  // Fire-and-forget last-used bump. Failures here must not deny the request.
  void app.touchVirtualKeyUsage(vk.id).catch(() => void 0);

  return {
    jwt,
    revision: vk.revision.toString(),
    key_id: vk.id,
    display_prefix: vk.displayPrefix,
  };
}

// ── §4.1 resolving a presented virtual key ──────────────────────────────

interface KeyAuthRejection {
  status: 401 | 403;
  type: string;
  code: string;
  message: string;
}

/**
 * Why the presented key does not parse, or null when it does. Anything that is
 * not a VirtualKeyCryptoError is a bug rather than a bad credential, so it
 * rethrows.
 */
function detectVirtualKeyParseRejection(presented: string): KeyAuthRejection | null {
  try {
    VirtualKeyCryptoService.parseSecret(presented);

    return null;
  } catch (err) {
    if (!(err instanceof VirtualKeyCryptoError)) throw err;

    return { status: 401, type: "invalid_api_key", code: err.code, message: err.message };
  }
}

/** Null if the key may serve; each rejection carries its own code so callers can branch on it. */
function detectVirtualKeyStatusRejection({
  status,
  expiresAt,
  now,
}: {
  status: string;
  expiresAt: Instant | null;
  now: Instant;
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
      message: "virtual key is disabled; it can be re-enabled by an administrator",
    };
  }
  if (expiresAt && expiresAt.epochMilliseconds <= now.epochMilliseconds) {
    return {
      status: 403,
      type: "virtual_key_expired",
      code: "virtual_key_expired",
      message: "virtual key has expired; extend its expiration or mint a new one",
    };
  }

  return null;
}

// ── the eleven addresses, exactly as the data plane dials them ───────────

export const gatewayInternalRest = defineRestRouter(GatewayApi)
  .withNamespace("gateway-internal")
  .withVersion(MANAGEMENT_API_VERSION)
  .withCredential("internalSecret")
  .withAddressing("literal", { v1Twin: false })

  // §4.7: probe for /health. Riding the signed channel is the point — a 200 here
  // also proves the shared HMAC secret matches, not just that the pod is up.
  .get("/api/internal/gateway/health", "gatewayInternalHealth")
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalHealthAnswers)
  .withDocs({ hide: true })
  .handle(() => answer({ status: "ok" }))

  // §4.1 — resolve a raw virtual key to a signed JWT and its current revision.
  .post("/api/internal/gateway/resolve-key", "gatewayInternalResolveKey")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalResolveKeyAnswers)
  .withDocs({ hide: true })
  .withHeaders(gatewayInternalHeadersSchema)
  .handle(async ({ app, raw }, headers) => {
    const presented = gatewayInternalResolveKeySchema.safeParse(readJson(raw) ?? {});
    if (!presented.success) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_key_presented",
        message: "key_presented is required",
      });
    }

    if (presented.data.key_presented.startsWith(LICENSE_TOKEN_PREFIX)) {
      const resolution = await app.resolveLicenseToken({
        token: presented.data.key_presented,
        instanceId: presented.data.instance_id,
      });
      if (!resolution.ok) {
        const refusal = LICENSE_TOKEN_REFUSALS[resolution.code];
        authDecisions.record({
          request: headers["x-langwatch-gateway-node"],
          code: resolution.code,
          status: refusal.status,
        });

        return refuse(refusal.status, {
          type: resolution.code,
          code: resolution.code,
          message: refusal.message,
        });
      }

      return answer(
        await keyResolution(app, {
          vk: resolution.key,
          notAfter: resolution.notAfter ?? null,
          connectServices: resolution.connectServices,
        }),
      );
    }

    const parseRejection = detectVirtualKeyParseRejection(presented.data.key_presented);
    if (parseRejection) {
      authDecisions.record({
        request: headers["x-langwatch-gateway-node"],
        code: parseRejection.code,
        status: parseRejection.status,
      });

      return refuse(parseRejection.status, { ...parseRejection });
    }

    const vk = await app.findVirtualKeyBySecret(presented.data.key_presented);
    if (!vk) {
      authDecisions.record({
        request: headers["x-langwatch-gateway-node"],
        code: "virtual_key_not_found",
        status: 401,
      });

      return refuse(401, {
        type: "invalid_api_key",
        code: "virtual_key_not_found",
        message: "unknown virtual key",
      });
    }

    const statusRejection = detectVirtualKeyStatusRejection({
      status: vk.status,
      expiresAt: vk.expiresAt,
      now: nowInstant(),
    });
    if (statusRejection) {
      authDecisions.record({
        request: headers["x-langwatch-gateway-node"],
        code: statusRejection.code,
        status: statusRejection.status,
        detail: { vkId: vk.id },
      });

      return refuse(statusRejection.status, { ...statusRejection });
    }

    return answer(await keyResolution(app, { vk, notAfter: vk.expiresAt }));
  })

  .post("/api/internal/gateway/codex/refresh", "gatewayInternalCodexRefresh")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalCodexRefreshAnswers)
  .withDocs({ hide: true })
  .handle(async ({ app, raw }) => {
    const parsed = gatewayInternalCodexRefreshSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_provider_row_id",
        message: "provider_row_id is required",
      });
    }

    const result = await app.refreshCodex({ providerRowId: parsed.data.provider_row_id });
    if (result.status === "unavailable") {
      // Refused by name rather than reported as a dead session: telling a
      // customer to sign in to Codex again would send them round a loop that
      // cannot end, because this deployment composes no provider service to
      // refresh against.
      return refuse(503, {
        type: "unavailable",
        code: "codex_refresh_unavailable",
        message: "this deployment composes no model provider service to refresh a Codex session",
      });
    }

    if (result.status === "not_connected") {
      return refuse(404, {
        type: "codex_not_connected",
        code: "codex_not_connected",
        message: "no connected Codex account on this provider",
      });
    }
    if (result.status === "session_expired") {
      logger.warn(
        { providerRowId: parsed.data.provider_row_id },
        "codex session expired; user must sign in again",
      );

      return refuse(401, {
        type: "codex_session_expired",
        code: "codex_session_expired",
        message: "OpenAI session expired; sign in to Codex again",
      });
    }

    return answer({ access_token: result.accessToken, account_id: result.accountId });
  })

  .get("/api/internal/gateway/config/:vk_id", "gatewayInternalConfig")
  .withParams(gatewayInternalConfigParamsSchema)
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalConfigAnswers)
  .withDocs({ hide: true })
  .withHeaders(gatewayInternalHeadersSchema)
  .handle(async ({ app, input }, headers) => {
    const vk = await app.findVirtualKeyForConfig(input.vk_id);
    if (!vk) {
      return refuse(404, {
        type: "invalid_api_key",
        code: "virtual_key_not_found",
        message: "unknown virtual key",
      });
    }

    const ifNoneMatch = headers["if-none-match"];
    const currentETag = await app.configVersionToken(vk);
    if (ifNoneMatch && ifNoneMatch === currentETag) {
      return {
        status: 304 as const,
        body: void 0,
        headers: { "content-type": PRODUCES_JSON, ETag: currentETag, "Cache-Control": "no-store" },
      };
    }

    // EC4 — the CH repo lets the materialiser stamp current-period spend
    // (sumMerge from the rollup) onto each applicable budget, so the gateway's
    // existing Precheck path sees fresh state on every re-materialise after a
    // BUDGET_UPDATED eviction — without this the wire output reads the stale
    // spentUsd PG column no writer updates.
    const payload = await app.materialiseConfig(vk);

    return {
      status: 200,
      headers: {
        "content-type": PRODUCES_JSON,
        ETag: currentETag,
        "Cache-Control": "no-store",
      },
      body: gatewayInternalConfigAnswers[200].parse(payload),
    } as const;
  })

  .get("/api/internal/gateway/changes", "gatewayInternalChanges")
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalChangesAnswers)
  .withDocs({ hide: true })
  .withQuery(gatewayInternalChangesQuerySchema)
  .handle(async ({ app, input }) => {
    const orgId = input.organization_id;
    if (!orgId) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_organization_id",
        message: "organization_id query param is required",
      });
    }

    let since: bigint;
    try {
      since = BigInt(input.since);
    } catch {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_since",
        message: "since must be an integer",
      });
    }

    const timeoutSeconds = Math.max(1, Math.min(25, Number.parseInt(input.timeout_s, 10) || 10));
    const deadline = nowInstant().epochMilliseconds + timeoutSeconds * 1000;

    while (nowInstant().epochMilliseconds < deadline) {
      const { events, currentRevision } = await app.listChanges(orgId, since, 500);
      if (events.length > 0) {
        return answer({
          current_revision: currentRevision.toString(),
          changes: events.map((e) => ({
            kind: e.kind,
            virtual_key_id: e.virtualKeyId,
            budget_id: e.budgetId,
            model_provider_id: e.modelProviderId,
            project_id: e.projectId,
            revision: e.revision.toString(),
          })),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    const current = await app.currentRevision(orgId);

    return {
      status: 204 as const,
      body: void 0,
      headers: { "X-LangWatch-Revision": current.toString() },
    };
  })

  .post("/api/internal/gateway/guardrail/check", "gatewayInternalGuardrailCheck")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalGuardrailAnswers)
  .withDocs({ hide: true })
  .handle(async ({ app, raw }) => {
    const body = readJson(raw);
    if (body === null) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_json",
        message: "guardrail/check requires a JSON body",
      });
    }

    const parsed = gatewayInternalGuardrailCheckSchema.safeParse(body);
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "validation_error",
        message: parsed.error.message,
      });
    }

    const check = await app.checkGuardrails({
      projectId: parsed.data.project_id,
      guardrailIds: parsed.data.guardrail_ids,
      direction: parsed.data.direction,
      content: parsed.data.content,
    });
    if (check.status === "unavailable") {
      // Refused, never allowed. A guardrail whose evaluator cannot produce a
      // verdict falls to its own failure mode rather than passing, and the same
      // rule holds one level up: a deployment with no evaluator runtime says so
      // instead of waving every request through an active protection.
      return refuse(503, {
        type: "unavailable",
        code: "guardrail_evaluation_unavailable",
        message: "this deployment composes no evaluator runtime to check a guardrail with",
      });
    }
    const { verdict } = check;

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

    return answer(verdict);
  })

  .get("/api/internal/gateway/budget-bucket-spend", "gatewayInternalBudgetBucketSpend")
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalBucketSpendAnswers)
  .withDocs({ hide: true })
  .withQuery(gatewayInternalBucketQuerySchema)
  .handle(async ({ app, input }) => {
    const budgetId = input.budget_id;
    const endUserId = input.end_user_id;
    if (!budgetId || !endUserId) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_parameter",
        message: "budget_id and end_user_id are required",
      });
    }

    const spend = await app.budgetBucketSpend({ budgetId, endUserId });
    if (spend.status === "not_found") {
      return refuse(404, {
        type: "not_found",
        code: "budget_not_found",
        message: "unknown attributed-user budget",
      });
    }

    return answer({ spent_micro_usd: spend.spentMicroUsd, bucket: spend.bucketScopeId });
  })

  .post("/api/internal/gateway/spend-commands", "gatewayInternalSpendCommands")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalSpendCommandsAnswers)
  .withDocs({ hide: true })
  .handle(async ({ app, raw }) => {
    const parsed = gatewayInternalSpendCommandBatchSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_batch",
        message: "records[] of {command, payload, pod_id, pod_seq} required",
      });
    }

    const result = await app.submitSpendCommands(parsed.data.records);
    if (result.status === "unavailable") {
      return refuse(503, {
        type: "unavailable",
        code: "spend_pipeline_disabled",
        message: "gateway spend pipeline is not registered (ClickHouse disabled)",
      });
    }

    if (result.status === "unregistered") {
      return refuse(503, {
        type: "unavailable",
        code: "spend_command_missing",
        message: `command ${result.command} is not registered`,
      });
    }

    return answer({ accepted: result.accepted, rejected: result.rejected });
  })

  // ── realtime voice sessions (ADR-097) ─────────────────────────────────
  .post("/api/internal/gateway/realtime-sessions", "gatewayInternalReserveRealtimeSession")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalReserveSessionAnswers)
  .withDocs({ hide: true })
  .handle(async ({ app, raw }) => {
    const parsed = gatewayInternalReserveSessionSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_reservation",
        message: "a session reservation names the session, its tenancy, its key and its vendor",
      });
    }

    const body = parsed.data;
    const result = await app.reserveRealtimeSession({
      sessionId: body.session_id,
      projectId: body.project_id,
      organizationId: body.organization_id,
      virtualKeyId: body.virtual_key_id,
      modelProviderId: body.model_provider_id,
      vendor: body.vendor,
      agentId: body.agent_id,
      model: body.model,
      traceId: body.trace_id,
      requestedModel: body.requested_model,
    });
    if (!result.ok && result.reason === "unavailable") return realtimeSessionsUnavailable();
    if (!result.ok) {
      return refuse(429, {
        type: "rate_limited",
        code: "realtime_session_limit",
        message:
          "this virtual key already holds the most realtime voice sessions it may keep open at once",
        open: result.open,
        limit: result.limit,
      });
    }

    return answer({ session_id: body.session_id, status: "OPEN" });
  })

  .patch(
    "/api/internal/gateway/realtime-sessions/:session_id",
    "gatewayInternalPatchRealtimeSession",
  )
  .withParams(gatewayInternalSessionParamsSchema)
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalPatchSessionAnswers)
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw }) => {
    const parsed = gatewayInternalPatchSessionSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_session_patch",
        message: "project_id is required, with a vendor_conversation_id or a terminal status",
      });
    }

    const sessionId = input.session_id;
    const body = parsed.data;
    let applied = false;
    if (body.vendor_conversation_id) {
      const correlated = await app.correlateRealtimeSession({
        sessionId,
        projectId: body.project_id,
        vendorConversationId: body.vendor_conversation_id,
      });
      if (correlated === "unavailable") return realtimeSessionsUnavailable();
      applied = correlated === "applied";
    }
    if (body.status) {
      const released = await app.releaseRealtimeSession({
        sessionId,
        projectId: body.project_id,
        status: body.status,
        reason: body.reason ?? "released by the gateway",
      });
      applied = released === "applied" || applied;
    }
    if (!applied) {
      return refuse(404, {
        type: "not_found",
        code: "realtime_session_not_found",
        message: "no session with that id belongs to this project",
      });
    }

    return answer({ session_id: sessionId, updated: true });
  })

  .post(
    "/api/internal/gateway/realtime-sessions/:session_id/usage",
    "gatewayInternalReportRealtimeSessionUsage",
  )
  .withParams(gatewayInternalSessionParamsSchema)
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalReportUsageAnswers)
  .withDocs({ hide: true })
  .handle(async ({ app, input, raw }) => {
    const parsed = gatewayInternalReportUsageSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_usage_report",
        message: "project_id, virtual_key_id and a usage object of integer quantities are required",
      });
    }

    const sessionId = input.session_id;
    const outcome = await app.reportRealtimeSessionUsage({
      sessionId,
      projectId: parsed.data.project_id,
      virtualKeyId: parsed.data.virtual_key_id,
      usage: parsed.data.usage,
    });
    if (outcome === "unavailable") return realtimeSessionsUnavailable();
    if (outcome === "not_found") {
      return refuse(404, {
        type: "not_found",
        code: "realtime_session_not_found",
        message: "no session with that id belongs to this project",
      });
    }

    return answer({ session_id: sessionId, status: "CLOSED" });
  })

  // §9 — startup bootstrap: a paginated stream of non-revoked virtual-key JWTs
  // for a cold-start gateway with the control plane offline. Enterprise opt-in
  // (LW_GATEWAY_BOOTSTRAP_PULL); the address answers 501 until it is built, so a
  // gateway that dials it learns that rather than 404ing on an unknown route.
  .get("/api/internal/gateway/bootstrap", "gatewayInternalBootstrap")
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalBootstrapAnswers)
  .withDocs({ hide: true })
  .handle(() =>
    refuse(501, {
      type: "internal_error",
      code: "not_implemented",
      message:
        "Stub. Contract-shaped response lands once VirtualKey/Budget service layer is wired. See specs/ai-gateway/_shared/contract.md §4.",
    }),
  )

  .build();
