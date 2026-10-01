/**
 * `/api/internal/gateway`: control plane between the two halves of one
 * deployment. Every route answers behind {@link GatewayInternalIdentityService}'s
 * HMAC gate; each capability is OPTIONAL, refusing (503) rather than silent.
 */
import { anyAuthenticated } from "@langwatch/api/access";
import {
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type RestDeclaredResult,
} from "@langwatch/api/rest";
import {
  gatewayInternalHeadersSchema,
  gatewayInternalChangesQuerySchema,
  gatewayInternalBucketQuerySchema,
  gatewayInternalConfigParamsSchema,
  gatewayInternalSessionParamsSchema,
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
} from "@langwatch/gateway-contract";
import { moduleApi } from "@langwatch/module";
import { resolveRequestBound } from "@langwatch/plans";
import type { z } from "zod";

const BODY_LIMIT_JSON_BYTES = resolveRequestBound("bodyLimitJsonBytes", "ENTERPRISE");

const PRODUCES_JSON = "application/json";

/**
 * Why these routes declare no credential the framework resolves. The whole gate
 * is the family's own HMAC, applied under its paths before any route.
 */
const GATEWAY_INTERNAL_GATE =
  "the Go data plane signs every call with the deployment's own gateway secret, and GatewayInternalIdentity verifies it under this family's paths before any route runs";

export type GatewayInternalRawRequest = Readonly<{ raw: string }>;
/** The data plane abandoning its call aborts the check (specs/ai-gateway/guardrails.feature). */
export type GatewayInternalGuardrailRequest = Readonly<{
  raw: string;
  signal: AbortSignal | undefined;
}>;
export type GatewayInternalSessionRequest = Readonly<{ sessionId: string; raw: string }>;
export type GatewayInternalResolveKeyRequest = Readonly<{ raw: string; node: string | undefined }>;
export type GatewayInternalConfigRequest = Readonly<{
  vkId: string;
  ifNoneMatch: string | undefined;
}>;
export type GatewayInternalChangesRequest = Readonly<{
  query: z.output<typeof gatewayInternalChangesQuerySchema>;
}>;
export type GatewayInternalBucketRequest = Readonly<{
  query: z.output<typeof gatewayInternalBucketQuerySchema>;
}>;

/** What the internal door reaches: each route's raw request in, its answer out. */
export interface GatewayInternalDoorApi {
  answerInternalResolveKey(
    input: GatewayInternalResolveKeyRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalResolveKeyAnswers>>;
  answerInternalCodexRefresh(
    input: GatewayInternalRawRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalCodexRefreshAnswers>>;
  answerInternalConfig(
    input: GatewayInternalConfigRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalConfigAnswers>>;
  answerInternalChanges(
    input: GatewayInternalChangesRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalChangesAnswers>>;
  answerInternalGuardrailCheck(
    input: GatewayInternalGuardrailRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalGuardrailAnswers>>;
  answerInternalBudgetBucketSpend(
    input: GatewayInternalBucketRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalBucketSpendAnswers>>;
  answerInternalSpendCommands(
    input: GatewayInternalRawRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalSpendCommandsAnswers>>;
  answerInternalReserveRealtimeSession(
    input: GatewayInternalRawRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalReserveSessionAnswers>>;
  answerInternalPatchRealtimeSession(
    input: GatewayInternalSessionRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalPatchSessionAnswers>>;
  answerInternalReportRealtimeUsage(
    input: GatewayInternalSessionRequest,
  ): Promise<RestDeclaredResult<typeof gatewayInternalReportUsageAnswers>>;
}

export const GatewayInternalDoorApi = moduleApi<GatewayInternalDoorApi>()("gateway");

function answer<const Body>(body: Body) {
  return { status: 200 as const, body };
}

function refuse<Status extends 501>(
  status: Status,
  error: { type: string; code: string; message: string },
) {
  return { status, body: { error } };
}

// ── the eleven addresses, exactly as the data plane dials them ───────────

export const gatewayInternalRest = defineRestRouter(GatewayInternalDoorApi)
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
  .handle(({ app, raw }, headers) =>
    app.answerInternalResolveKey({ raw, node: headers["x-langwatch-gateway-node"] }),
  )

  .post("/api/internal/gateway/codex/refresh", "gatewayInternalCodexRefresh")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalCodexRefreshAnswers)
  .withDocs({ hide: true })
  .handle(({ app, raw }) => app.answerInternalCodexRefresh({ raw }))

  .get("/api/internal/gateway/config/:vk_id", "gatewayInternalConfig")
  .withParams(gatewayInternalConfigParamsSchema)
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalConfigAnswers)
  .withDocs({ hide: true })
  .withHeaders(gatewayInternalHeadersSchema)
  .handle(({ app, input }, headers) =>
    app.answerInternalConfig({ vkId: input.vk_id, ifNoneMatch: headers["if-none-match"] }),
  )

  .get("/api/internal/gateway/changes", "gatewayInternalChanges")
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalChangesAnswers)
  .withDocs({ hide: true })
  .withQuery(gatewayInternalChangesQuerySchema)
  .handle(({ app, input }) => app.answerInternalChanges({ query: input }))

  .post("/api/internal/gateway/guardrail/check", "gatewayInternalGuardrailCheck")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalGuardrailAnswers)
  .withDocs({ hide: true })
  .handle(({ app, raw, signal }) => app.answerInternalGuardrailCheck({ raw, signal }))

  .get("/api/internal/gateway/budget-bucket-spend", "gatewayInternalBudgetBucketSpend")
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalBucketSpendAnswers)
  .withDocs({ hide: true })
  .withQuery(gatewayInternalBucketQuerySchema)
  .handle(({ app, input }) => app.answerInternalBudgetBucketSpend({ query: input }))

  .post("/api/internal/gateway/spend-commands", "gatewayInternalSpendCommands")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalSpendCommandsAnswers)
  .withDocs({ hide: true })
  .handle(({ app, raw }) => app.answerInternalSpendCommands({ raw }))

  // ── realtime voice sessions (ADR-097) ─────────────────────────────────
  .post("/api/internal/gateway/realtime-sessions", "gatewayInternalReserveRealtimeSession")
  .withRawBody("text", { mediaType: PRODUCES_JSON })
  .withBodyLimit({ maxBytes: BODY_LIMIT_JSON_BYTES })
  .withAccess(anyAuthenticated({ reason: GATEWAY_INTERNAL_GATE }))
  .responds(gatewayInternalReserveSessionAnswers)
  .withDocs({ hide: true })
  .handle(({ app, raw }) => app.answerInternalReserveRealtimeSession({ raw }))

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
  .handle(({ app, input, raw }) =>
    app.answerInternalPatchRealtimeSession({ sessionId: input.session_id, raw }),
  )

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
  .handle(({ app, input, raw }) =>
    app.answerInternalReportRealtimeUsage({ sessionId: input.session_id, raw }),
  )

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
