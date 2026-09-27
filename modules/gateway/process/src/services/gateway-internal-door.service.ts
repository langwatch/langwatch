/**
 * `/api/internal/gateway`'s answers, in the Go plane's own envelope: each route's raw request in,
 * its `{ status, body }` out, exactly as main answered it. Every capability is OPTIONAL and
 * refuses (503) rather than going silent.
 */
import type { RestDeclaredResult } from "@langwatch/api/rest";
import {
  type gatewayInternalBucketSpendAnswers,
  type gatewayInternalChangesAnswers,
  type gatewayInternalChangesQuerySchema,
  type gatewayInternalCodexRefreshAnswers,
  gatewayInternalCodexRefreshSchema,
  gatewayInternalConfigAnswers,
  type gatewayInternalGuardrailAnswers,
  gatewayInternalGuardrailCheckSchema,
  type GatewayInternalProtocol,
  type gatewayInternalBucketQuerySchema,
  type gatewayInternalPatchSessionAnswers,
  gatewayInternalPatchSessionSchema,
  type gatewayInternalReportUsageAnswers,
  gatewayInternalReportUsageSchema,
  type gatewayInternalReserveSessionAnswers,
  gatewayInternalReserveSessionSchema,
  type gatewayInternalResolveKeyAnswers,
  gatewayInternalResolveKeySchema,
  gatewayInternalSpendCommandBatchSchema,
  type gatewayInternalSpendCommandsAnswers,
  type GatewayLicenseTokenRefusal,
  type GatewayVirtualKeyRecord,
  LICENSE_TOKEN_PREFIX,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";
import type { z } from "zod";

import { GatewayAuthDecisionService } from "./gateway-auth-decision.service.ts";
import { VirtualKeyCryptoError, VirtualKeyCryptoService } from "./virtual-key-crypto.service.ts";

const logger = createLogger("langwatch:gateway-internal");

const PRODUCES_JSON = "application/json";
const CHANGES_PAGE = 500;
const CHANGES_POLL_MS = 2000;

type RefusalStatus = 400 | 401 | 403 | 404 | 429 | 501 | 503;
type Refusal = { type: string; code: string; message: string } & Record<string, unknown>;

function answer<const Body>(body: Body) {
  return { status: 200 as const, body };
}

function refuse<Status extends RefusalStatus>(status: Status, error: Refusal) {
  return { status, body: { error } };
}

/** 503 when no session store: the gateway must refuse the mint, not book an unbilled call. */
const realtimeSessionsUnavailable = () =>
  refuse(503, {
    type: "unavailable",
    code: "realtime_sessions_unavailable",
    message: "this deployment composes no realtime voice session store",
  });

const realtimeSessionNotFound = () =>
  refuse(404, {
    type: "not_found",
    code: "realtime_session_not_found",
    message: "no session with that id belongs to this project",
  });

/** The body a route reads for itself, or `null` when the bytes were not JSON. */
function readJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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

interface KeyAuthRejection {
  status: 401 | 403;
  type: string;
  code: string;
  message: string;
}

/**
 * Why the presented key does not parse, or null when it does. Anything that is
 * not a VirtualKeyCryptoError is a bug rather than a bad credential, so it rethrows.
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

type ResolveKeyAnswer = RestDeclaredResult<typeof gatewayInternalResolveKeyAnswers>;

/** The internal control plane's door: each route's logic over the internal protocol. */
export class GatewayInternalDoorService {
  static create({ protocol }: { protocol: GatewayInternalProtocol }): GatewayInternalDoorService {
    return new GatewayInternalDoorService(protocol, GatewayAuthDecisionService.create({ logger }));
  }

  private constructor(
    private readonly protocol: GatewayInternalProtocol,
    private readonly authDecisions: GatewayAuthDecisionService,
  ) {}

  /** §4.1: a raw virtual key or license token, resolved to a signed JWT and its revision. */
  async answerResolveKey({
    raw,
    node,
  }: {
    raw: string;
    node: string | undefined;
  }): Promise<ResolveKeyAnswer> {
    const presented = gatewayInternalResolveKeySchema.safeParse(readJson(raw) ?? {});
    if (!presented.success) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_key_presented",
        message: "key_presented is required",
      });
    }
    const { key_presented: keyPresented, instance_id: instanceId } = presented.data;
    if (keyPresented.startsWith(LICENSE_TOKEN_PREFIX)) {
      return this.resolveLicenseToken({ token: keyPresented, instanceId, node });
    }
    return this.resolveVirtualKey({ presented: keyPresented, node });
  }

  private async resolveLicenseToken({
    token,
    instanceId,
    node,
  }: {
    token: string;
    instanceId: string | undefined;
    node: string | undefined;
  }): Promise<ResolveKeyAnswer> {
    const resolution = await this.protocol.resolveLicenseToken({ token, instanceId });
    if (!resolution.ok) {
      const refusal = LICENSE_TOKEN_REFUSALS[resolution.code];
      this.authDecisions.record({ request: node, code: resolution.code, status: refusal.status });
      return refuse(refusal.status, {
        type: resolution.code,
        code: resolution.code,
        message: refusal.message,
      });
    }
    return answer(
      await this.keyResolution({
        vk: resolution.key,
        notAfter: resolution.notAfter ?? null,
        connectServices: resolution.connectServices,
      }),
    );
  }

  private async resolveVirtualKey({
    presented,
    node,
  }: {
    presented: string;
    node: string | undefined;
  }): Promise<ResolveKeyAnswer> {
    const parseRejection = detectVirtualKeyParseRejection(presented);
    if (parseRejection) {
      this.authDecisions.record({
        request: node,
        code: parseRejection.code,
        status: parseRejection.status,
      });
      return refuse(parseRejection.status, { ...parseRejection });
    }

    const vk = await this.protocol.findVirtualKeyBySecret(presented);
    if (!vk) {
      this.authDecisions.record({ request: node, code: "virtual_key_not_found", status: 401 });
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
      this.authDecisions.record({
        request: node,
        code: statusRejection.code,
        status: statusRejection.status,
        detail: { vkId: vk.id },
      });
      return refuse(statusRejection.status, { ...statusRejection });
    }

    return answer(await this.keyResolution({ vk, notAfter: vk.expiresAt }));
  }

  /**
   * Signs for a key that may serve. `notAfter` ends the token at the key's (or the
   * license's) end when that comes before the 15 minute TTL, so an auth cache never
   * outlives the key; a license's services travel as the `connect_services` claim.
   */
  private async keyResolution({
    vk,
    notAfter,
    connectServices,
  }: {
    vk: GatewayVirtualKeyRecord;
    notAfter: Instant | null;
    connectServices?: string[];
  }) {
    // Null for a key written before the destination was stored, in an organization
    // with no governance project: the gateway then skips span export instead.
    const traceProject = vk.traceProjectId
      ? await this.protocol.findTraceDestination(vk.traceProjectId)
      : null;
    const { jwt } = this.protocol.signJwt({
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
    void this.protocol.touchVirtualKeyUsage(vk.id).catch(() => void 0);

    return {
      jwt,
      revision: vk.revision.toString(),
      key_id: vk.id,
      display_prefix: vk.displayPrefix,
    };
  }

  async answerCodexRefresh({
    raw,
  }: {
    raw: string;
  }): Promise<RestDeclaredResult<typeof gatewayInternalCodexRefreshAnswers>> {
    const parsed = gatewayInternalCodexRefreshSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_provider_row_id",
        message: "provider_row_id is required",
      });
    }

    const result = await this.protocol.refreshCodex({
      providerRowId: parsed.data.provider_row_id,
    });
    if (result.status === "unavailable") {
      // Refused by name rather than reported as a dead session: telling a customer to sign in
      // again would loop forever, since this deployment has no provider service to refresh on.
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
  }

  async answerConfig({
    vkId,
    ifNoneMatch,
  }: {
    vkId: string;
    ifNoneMatch: string | undefined;
  }): Promise<RestDeclaredResult<typeof gatewayInternalConfigAnswers>> {
    const vk = await this.protocol.findVirtualKeyForConfig(vkId);
    if (!vk) {
      return refuse(404, {
        type: "invalid_api_key",
        code: "virtual_key_not_found",
        message: "unknown virtual key",
      });
    }

    const currentETag = await this.protocol.configVersionToken(vk);
    const headers = {
      "content-type": PRODUCES_JSON,
      ETag: currentETag,
      "Cache-Control": "no-store",
    };
    if (ifNoneMatch && ifNoneMatch === currentETag) {
      return { status: 304 as const, body: void 0, headers };
    }

    // EC4: materialising stamps current-period spend (sumMerge from the rollup) onto each
    // applicable budget, so the gateway's Precheck sees fresh state after a BUDGET_UPDATED
    // eviction instead of the stale spentUsd column no writer updates.
    const payload = await this.protocol.materialiseConfig(vk);
    return {
      status: 200 as const,
      headers,
      body: gatewayInternalConfigAnswers[200].parse(payload),
    };
  }

  async answerChanges({
    query,
  }: {
    query: z.output<typeof gatewayInternalChangesQuerySchema>;
  }): Promise<RestDeclaredResult<typeof gatewayInternalChangesAnswers>> {
    const orgId = query.organization_id;
    if (!orgId) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_organization_id",
        message: "organization_id query param is required",
      });
    }

    let since: bigint;
    try {
      since = BigInt(query.since);
    } catch {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_since",
        message: "since must be an integer",
      });
    }

    const timeoutSeconds = Math.max(1, Math.min(25, Number.parseInt(query.timeout_s, 10) || 10));
    const deadline = nowInstant().epochMilliseconds + timeoutSeconds * 1000;
    while (nowInstant().epochMilliseconds < deadline) {
      const { events, currentRevision } = await this.protocol.listChanges(
        orgId,
        since,
        CHANGES_PAGE,
      );
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
      await new Promise((resolve) => setTimeout(resolve, CHANGES_POLL_MS));
    }

    const current = await this.protocol.currentRevision(orgId);
    return {
      status: 204 as const,
      body: void 0,
      headers: { "X-LangWatch-Revision": current.toString() },
    };
  }

  async answerGuardrailCheck({
    raw,
  }: {
    raw: string;
  }): Promise<RestDeclaredResult<typeof gatewayInternalGuardrailAnswers>> {
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

    const check = await this.protocol.checkGuardrails({
      projectId: parsed.data.project_id,
      guardrailIds: parsed.data.guardrail_ids,
      direction: parsed.data.direction,
      content: parsed.data.content,
    });
    if (check.status === "unavailable") {
      // Refused, never allowed: a deployment with no evaluator runtime says so instead of
      // waving every request through an active protection.
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
  }

  async answerBudgetBucketSpend({
    query,
  }: {
    query: z.output<typeof gatewayInternalBucketQuerySchema>;
  }): Promise<RestDeclaredResult<typeof gatewayInternalBucketSpendAnswers>> {
    const budgetId = query.budget_id;
    const endUserId = query.end_user_id;
    if (!budgetId || !endUserId) {
      return refuse(400, {
        type: "bad_request",
        code: "missing_parameter",
        message: "budget_id and end_user_id are required",
      });
    }

    const spend = await this.protocol.budgetBucketSpend({ budgetId, endUserId });
    if (spend.status === "not_found") {
      return refuse(404, {
        type: "not_found",
        code: "budget_not_found",
        message: "unknown attributed-user budget",
      });
    }
    return answer({ spent_micro_usd: spend.spentMicroUsd, bucket: spend.bucketScopeId });
  }

  async answerSpendCommands({
    raw,
  }: {
    raw: string;
  }): Promise<RestDeclaredResult<typeof gatewayInternalSpendCommandsAnswers>> {
    const parsed = gatewayInternalSpendCommandBatchSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_batch",
        message: "records[] of {command, payload, pod_id, pod_seq} required",
      });
    }

    const result = await this.protocol.submitSpendCommands(parsed.data.records);
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
  }

  async answerReserveRealtimeSession({
    raw,
  }: {
    raw: string;
  }): Promise<RestDeclaredResult<typeof gatewayInternalReserveSessionAnswers>> {
    const parsed = gatewayInternalReserveSessionSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_reservation",
        message: "a session reservation names the session, its tenancy, its key and its vendor",
      });
    }

    const body = parsed.data;
    const result = await this.protocol.reserveRealtimeSession({
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
  }

  async answerPatchRealtimeSession({
    sessionId,
    raw,
  }: {
    sessionId: string;
    raw: string;
  }): Promise<RestDeclaredResult<typeof gatewayInternalPatchSessionAnswers>> {
    const parsed = gatewayInternalPatchSessionSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_session_patch",
        message: "project_id is required, with a vendor_conversation_id or a terminal status",
      });
    }

    const body = parsed.data;
    let applied = false;
    if (body.vendor_conversation_id) {
      const correlated = await this.protocol.correlateRealtimeSession({
        sessionId,
        projectId: body.project_id,
        vendorConversationId: body.vendor_conversation_id,
      });
      if (correlated === "unavailable") return realtimeSessionsUnavailable();
      applied = correlated === "applied";
    }
    if (body.status) {
      const released = await this.protocol.releaseRealtimeSession({
        sessionId,
        projectId: body.project_id,
        status: body.status,
        reason: body.reason ?? "released by the gateway",
      });
      applied = released === "applied" || applied;
    }
    if (!applied) return realtimeSessionNotFound();
    return answer({ session_id: sessionId, updated: true });
  }

  async answerReportRealtimeUsage({
    sessionId,
    raw,
  }: {
    sessionId: string;
    raw: string;
  }): Promise<RestDeclaredResult<typeof gatewayInternalReportUsageAnswers>> {
    const parsed = gatewayInternalReportUsageSchema.safeParse(readJson(raw));
    if (!parsed.success) {
      return refuse(400, {
        type: "bad_request",
        code: "invalid_usage_report",
        message: "project_id, virtual_key_id and a usage object of integer quantities are required",
      });
    }

    const outcome = await this.protocol.reportRealtimeSessionUsage({
      sessionId,
      projectId: parsed.data.project_id,
      virtualKeyId: parsed.data.virtual_key_id,
      usage: parsed.data.usage,
    });
    if (outcome === "unavailable") return realtimeSessionsUnavailable();
    if (outcome === "not_found") return realtimeSessionNotFound();
    return answer({ session_id: sessionId, status: "CLOSED" });
  }
}
