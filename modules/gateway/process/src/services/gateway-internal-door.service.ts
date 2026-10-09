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
  gatewayInternalSpendCommandBatchSchema,
  type gatewayInternalSpendCommandsAnswers,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, Temporal, type Instant } from "@langwatch/time";
import type { z } from "zod";

import { answer, readJson, refuse } from "../rules/gateway-internal-door.rules.ts";
import { GatewayAuthDecisionService } from "./gateway-auth-decision.service.ts";
import { GatewayInternalKeyResolutionService } from "./gateway-internal-key-resolution.service.ts";

const logger = createLogger("langwatch:gateway-internal");

const PRODUCES_JSON = "application/json";
const CHANGES_PAGE = 500;
const CHANGES_POLL_MS = 2000;

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

/** The credential expiry a body carried in epoch milliseconds, as a protocol call takes it. */
function credentialExpiryOf(body: { credential_expires_at?: number | undefined }): {
  credentialExpiresAt?: Instant;
} {
  return body.credential_expires_at === undefined
    ? {}
    : { credentialExpiresAt: Temporal.Instant.fromEpochMilliseconds(body.credential_expires_at) };
}

/** The internal control plane's door: each route's logic over the internal protocol. */
export class GatewayInternalDoorService {
  static create({ protocol }: { protocol: GatewayInternalProtocol }): GatewayInternalDoorService {
    return new GatewayInternalDoorService(protocol, GatewayAuthDecisionService.create({ logger }));
  }

  private readonly keys: GatewayInternalKeyResolutionService;

  private constructor(
    private readonly protocol: GatewayInternalProtocol,
    authDecisions: GatewayAuthDecisionService,
  ) {
    this.keys = GatewayInternalKeyResolutionService.create({ protocol, authDecisions });
  }

  /** §4.1: a raw virtual key or license token, resolved to a signed JWT and its revision. */
  answerResolveKey(input: {
    raw: string;
    node: string | undefined;
  }): Promise<RestDeclaredResult<typeof gatewayInternalResolveKeyAnswers>> {
    return this.keys.answerResolveKey(input);
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
    signal,
  }: {
    raw: string;
    signal?: AbortSignal | undefined;
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
      signal,
    });
    if (check.status === "deadline_exceeded") {
      return refuse(503, {
        type: "service_unavailable",
        code: "guardrail_deadline_exceeded",
        message: "a fail-closed guardrail had no verdict before its deadline; retry the request",
        retryable: true,
      });
    }
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
      kind: body.kind,
      metering: body.metering,
      transcriptionModel: body.transcription_model,
      endUserId: body.end_user_id,
      ...credentialExpiryOf(body),
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
        message:
          "project_id is required, with a vendor_conversation_id, a credential_expires_at or a terminal status",
      });
    }

    const body = parsed.data;
    let applied = false;
    if (body.vendor_conversation_id || body.credential_expires_at) {
      const correlated = await this.protocol.correlateRealtimeSession({
        sessionId,
        projectId: body.project_id,
        vendorConversationId: body.vendor_conversation_id,
        ...credentialExpiryOf(body),
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
        message:
          "project_id and virtual_key_id are required, with a usage object of integer quantities unless final is true",
      });
    }

    const body = parsed.data;
    const outcome = await this.protocol.reportRealtimeSessionUsage({
      sessionId,
      projectId: body.project_id,
      virtualKeyId: body.virtual_key_id,
      usage: body.usage,
      reportKey: body.report_key,
      model: body.model,
      pricedAs: body.priced_as,
      final: body.final,
      durationMs: body.duration_ms,
      source: body.source,
    });
    if (outcome === "unavailable") return realtimeSessionsUnavailable();
    if (outcome === "not_found") return realtimeSessionNotFound();
    return answer({
      session_id: sessionId,
      status: outcome.status,
      cost_nano_usd: outcome.costNanoUsd,
      session_cost_nano_usd: outcome.sessionCostNanoUsd,
      budget: {
        exceeded: outcome.budget.exceeded,
        ...(outcome.budget.scope ? { scope: outcome.budget.scope } : {}),
        ...(outcome.budget.budgetId ? { budget_id: outcome.budget.budgetId } : {}),
        ...(outcome.budget.unknown ? { unknown: true as const } : {}),
      },
    });
  }
}
