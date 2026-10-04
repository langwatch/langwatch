/**
 * @see ADR-097
 * The record of brokered realtime voice sessions. A session outlives its minting request, its
 * report can land on any replica, and the per-key cap must be counted where every replica sees it.
 */

import { createHash } from "crypto";

import type {
  GatewayBudgetCheckInput,
  GatewayBudgetCheckResult,
  GatewayRealtimeMetering,
  GatewayRealtimeSessionRecord,
  GatewayRealtimeSession,
  GatewayRealtimeSessionReport,
  GatewayRealtimeSessionStatus,
  SpendUsage,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";
import { ATTR_KEYS as ATTR, DEFAULT_PII_REDACTION_LEVEL } from "@langwatch/trace-contract";

import type {
  GatewaySpanIngestion,
  GatewaySpendConfirmation,
  GatewaySpendRating,
} from "../app/gateway.members.ts";
import type {
  GatewayRealtimeSessionRepository,
  ReserveResult,
} from "../repositories/gateway-realtime-session.repository.ts";
import { sumRealtimeUsage } from "../rules/gateway-realtime-session-metering.rules.ts";
import { EMPTY_SPEND_USAGE } from "../rules/gateway-spend-projection.rules.ts";

const logger = createLogger("langwatch:gateway:realtime-session");

/**
 * How far back the cap counts. OpenAI's realtime socket never signals close, so a session can only
 * be closed by a usage report the client may never send, and counting every open row ever would
 * ratchet a key to zero capacity. One hour is that vendor's own maximum session length.
 */
export const REALTIME_OPEN_SESSION_WINDOW_MS = 60 * 60 * 1000;

/** What a session closed by the window rather than by a report says it closed for. */
export const REALTIME_EXPIRY_CLOSE_REASON =
  "no vendor report arrived within the longest possible call";

/** Who a session's spend is charged to beyond its key: what only the control plane can join. */
export type GatewayRealtimeSessionAttribution = {
  principalUserId: string | null;
  teamId: string | null;
};

/**
 * Everything this service reaches outside itself, named rather than resolved from a process
 * singleton: voice settlement writes money, and a second process quietly composing a second
 * database or rating table would give two answers to what one call cost.
 */
export type GatewayRealtimeSessionCollaborators = {
  sessions: GatewayRealtimeSessionRepository;
  /** Prices the vendor's quantities. The one rating seam for the vertical. */
  spendRating: GatewaySpendRating;
  /** Sends the confirmation into the gateway spend pipeline. */
  spendConfirmation: GatewaySpendConfirmation;
  /**
   * Writes the settlement span. Absent where the deployment composes no trace
   * storage: the money still lands, the trace just carries no cost line.
   */
  spanIngestion?: GatewaySpanIngestion | undefined;
  /**
   * Joins the key's owner and the project's team onto a confirmation, so their budgets are
   * debited. Absent, a confirmation names the organization, project and key only.
   */
  attribution?:
    | {
        findSessionAttribution(input: {
          virtualKeyId: string;
          projectId: string;
        }): Promise<GatewayRealtimeSessionAttribution>;
      }
    | undefined;
  /** The budget read a usage report answers with. Absent, the verdict is unknown. */
  budgets?:
    | { checkBudget(input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult> }
    | undefined;
};

export interface ReserveInput {
  sessionId: string;
  projectId: string;
  organizationId: string;
  virtualKeyId: string;
  modelProviderId: string;
  vendor: string;
  agentId?: string;
  model: string;
  /**
   * The customer-facing trace the mint's own span belongs to, so the
   * settlement can write this call's cost back into that trace. Absent for a
   * request with no trace context.
   */
  traceId?: string;
  requestedModel?: string;
  kind?: string;
  metering?: GatewayRealtimeMetering;
  transcriptionModel?: string;
  endUserId?: string;
  credentialExpiresAt?: Instant;
}

/**
 * The record of brokered realtime voice sessions: booking, correlation,
 * closure and expiry. Every call names the collaborators it runs against, so
 * one process can serve more than one composed database.
 */
export class GatewayRealtimeSessionService {
  static create(): GatewayRealtimeSessionService {
    return new GatewayRealtimeSessionService();
  }

  private constructor() {}

  /**
   * Books a session, deciding the per-key cap in the same transaction that inserts the row. The
   * advisory lock is what makes the cap a cap: without it two racing mints both read the count
   * before either insert lands. The limit is read here, so count and limit share one instant.
   */
  async reserveRealtimeSession(
    input: ReserveInput & { collaborators: GatewayRealtimeSessionCollaborators },
  ): Promise<ReserveResult> {
    return input.collaborators.sessions.reserve({
      session: {
        id: input.sessionId,
        projectId: input.projectId,
        organizationId: input.organizationId,
        virtualKeyId: input.virtualKeyId,
        modelProviderId: input.modelProviderId,
        vendor: input.vendor,
        agentId: input.agentId ?? null,
        model: input.model,
        traceId: input.traceId ?? null,
        requestedModel: input.requestedModel ?? null,
        kind: input.kind ?? null,
        metering: input.metering ?? null,
        transcriptionModel: input.transcriptionModel ?? null,
        endUserId: input.endUserId || null,
        credentialExpiresAt: input.credentialExpiresAt ?? null,
      },
      staleBefore: nowInstant().subtract({ milliseconds: REALTIME_OPEN_SESSION_WINDOW_MS }),
      closeReason: REALTIME_EXPIRY_CLOSE_REASON,
    });
  }

  /** Records what the mint learned after booking: the conversation id, the credential's expiry. */
  async correlateRealtimeSession(params: {
    sessionId: string;
    projectId: string;
    vendorConversationId?: string;
    credentialExpiresAt?: Instant;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<boolean> {
    return params.collaborators.sessions.correlate({
      sessionId: params.sessionId,
      projectId: params.projectId,
      ...(params.vendorConversationId === undefined
        ? {}
        : { vendorConversationId: params.vendorConversationId }),
      ...(params.credentialExpiresAt === undefined
        ? {}
        : { credentialExpiresAt: params.credentialExpiresAt }),
    });
  }

  /** Closes a session that never opened, so the cap stops counting it. */
  async releaseRealtimeSession(params: {
    sessionId: string;
    projectId: string;
    status: GatewayRealtimeSessionStatus;
    reason: string;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<boolean> {
    return params.collaborators.sessions.release({
      sessionId: params.sessionId,
      projectId: params.projectId,
      status: params.status,
      closeReason: params.reason.slice(0, 256),
    });
  }

  /**
   * Finds the session a vendor's post-call report belongs to, three ways in order of certainty:
   * the conversation id recorded at mint, the LangWatch session id echoed back, then the single
   * session open for this credential in the window — stopping at exactly one candidate.
   */
  async findMatchingRealtimeSession(params: {
    vendor: string;
    organizationId: string;
    modelProviderId: string;
    vendorConversationId?: string;
    echoedSessionId?: string;
    callStartedAt?: Instant;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<GatewayRealtimeSession | null> {
    const sessions = params.collaborators.sessions;
    // Every branch is scoped to the organization that owns the credential the
    // delivery was signed for. A conversation id is the vendor's, not ours, so
    // without that scope one tenant's delivery could name another's session.
    const tenancy = {
      organizationId: params.organizationId,
      vendor: params.vendor,
    };

    if (params.vendorConversationId) {
      const exact = await sessions.findByVendorConversationId({
        ...tenancy,
        vendorConversationId: params.vendorConversationId,
      });
      if (exact) {
        return exact;
      }
    }

    if (params.echoedSessionId) {
      const echoed = await sessions.findById({ ...tenancy, id: params.echoedSessionId });
      if (echoed) {
        return echoed;
      }
    }

    const since = (params.callStartedAt ?? nowInstant()).subtract({
      milliseconds: REALTIME_OPEN_SESSION_WINDOW_MS,
    });
    // Two candidates is already one too many, so two is all that is read.
    const candidates = await sessions.findOpenSince({
      ...tenancy,
      modelProviderId: params.modelProviderId,
      since,
      limit: 2,
    });
    if (candidates.length === 1) {
      return candidates[0] ?? null;
    }

    logger.warn(
      { vendor: params.vendor, candidates: candidates.length },
      "a realtime post-call report matched no single open session; it settles as cost-unknown rather than being charged to a guess",
    );

    return null;
  }

  /**
   * Closes a session with what the vendor reported and confirms its spend, sent into the gateway
   * spend pipeline exactly as its own drainer would, so redelivery collapses on the idempotency
   * key. The vendor's own cost figure is stored beside ours and never billed from.
   */
  async closeAndConfirmRealtimeSession(params: {
    session: GatewayRealtimeSessionRecord;
    usage: Partial<SpendUsage>;
    vendorCostRaw?: unknown;
    occurredAt?: Instant;
    durationMs?: number;
    reason: string;
    /** Already joined by the caller; otherwise read here. */
    attribution?: GatewayRealtimeSessionAttribution;
    /** The session's reports when the caller already read them; otherwise read after the close. */
    reports?: readonly GatewayRealtimeSessionReport[];
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<{ closed: boolean; costNanoUsd: number }> {
    const occurredAt = params.occurredAt ?? nowInstant();
    const usage: SpendUsage = { ...EMPTY_SPEND_USAGE, ...params.usage };
    const { session, collaborators } = params;

    // Confirmation goes first; the row closes only once it has landed. The other order loses
    // money: a closed row whose confirm failed is never retried, since it is no longer open.
    // Both steps are idempotent, so a repeat confirm/close is a no-op.
    const rated = collaborators.spendRating.rate({ model: session.model, usage });
    await this.confirmRealtimeSpend({
      session,
      gatewayRequestId: session.id,
      requestType: "realtime_session",
      model: session.model,
      usage,
      rated,
      durationMs: params.durationMs ?? 0,
      occurredAt,
      ...(params.attribution ? { attribution: params.attribution } : {}),
      collaborators,
    });

    const closed = await collaborators.sessions.close({
      sessionId: session.id,
      projectId: session.projectId,
      closedAt: occurredAt,
      closeReason: params.reason.slice(0, 256),
      settledCostNanoUsd: rated.costNanoUsd,
      ...(params.vendorCostRaw === undefined ? {} : { vendorCostRaw: params.vendorCostRaw }),
    });
    if (closed === 0) {
      logger.info(
        { sessionId: session.id },
        "a realtime report arrived for a session that was already closed",
      );

      return { closed: false, costNanoUsd: rated.costNanoUsd };
    }

    // One session, one span, emitted by whichever confirmation won the close, so a resent
    // webhook or a retried report adds nothing. It states the whole call: every report
    // recorded while it ran, plus what the session's own record confirmed just now.
    const reports =
      params.reports ??
      (await collaborators.sessions.findReports({
        sessionId: session.id,
        projectId: session.projectId,
      }));
    await recordRealtimeSessionSpan({
      session,
      usage: sumRealtimeUsage({ usages: [...reports.map((report) => report.usage), usage] }),
      costNanoUsd: reports.reduce((total, report) => total + report.costNanoUsd, rated.costNanoUsd),
      durationMs: params.durationMs ?? 0,
      occurredAt,
      spanIngestion: collaborators.spanIngestion,
    });

    return { closed: true, costNanoUsd: rated.costNanoUsd };
  }

  /**
   * Sends one confirmation for a session into the gateway spend pipeline. Emitted here rather
   * than by the gateway, so it carries what the gateway would have: the session row recorded
   * the organization, key and trace at the mint, and the owner and team are joined here.
   */
  async confirmRealtimeSpend(params: {
    session: GatewayRealtimeSessionRecord;
    gatewayRequestId: string;
    requestType: string;
    model: string;
    usage: SpendUsage;
    rated: { costNanoUsd: number; rateVersion: string };
    durationMs: number;
    occurredAt: Instant;
    attribution?: GatewayRealtimeSessionAttribution;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<void> {
    const { session } = params;
    const attribution =
      params.attribution ??
      (await this.findRealtimeSessionAttribution({ session, collaborators: params.collaborators }));
    await params.collaborators.spendConfirmation.confirmSpend({
      gateway_request_id: params.gatewayRequestId,
      occurred_at: params.occurredAt.epochMilliseconds,
      tenantId: session.projectId,
      model: params.model,
      model_provider_id: session.modelProviderId,
      usage: params.usage,
      cost_nano_usd: params.rated.costNanoUsd,
      rate_version: params.rated.rateVersion,
      duration_ms: params.durationMs,
      organization_id: session.organizationId,
      virtual_key_id: session.virtualKeyId,
      request_type: params.requestType,
      admitted_at: session.mintedAt.epochMilliseconds,
      end_user_id: session.endUserId ?? "",
      // The trace is the mint's, so the spend record and the settlement span can be joined.
      trace_id: session.traceId ?? "",
      principal_user_id: attribution.principalUserId ?? "",
      team_id: attribution.teamId ?? "",
      labels: [],
      metadata: "",
    });
  }

  /** The owner and team a session's spend is also charged to; neither when none is composed. */
  async findRealtimeSessionAttribution(params: {
    session: Pick<GatewayRealtimeSessionRecord, "virtualKeyId" | "projectId">;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<GatewayRealtimeSessionAttribution> {
    const reader = params.collaborators.attribution;
    if (!reader) return { principalUserId: null, teamId: null };

    return reader.findSessionAttribution({
      virtualKeyId: params.session.virtualKeyId,
      projectId: params.session.projectId,
    });
  }

  /**
   * Marks as expired the sessions no report ever closed, since a row older than the window cannot
   * still be running and would hold a cap slot forever. It runs under the cap count's own advisory
   * lock, scoped to one key, so it costs one bounded write rather than a table sweep.
   */
  async expireStaleRealtimeSessions(params: {
    virtualKeyId?: string;
    now?: Instant;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<number> {
    const now = params.now ?? nowInstant();

    return params.collaborators.sessions.expireStale({
      ...(params.virtualKeyId ? { virtualKeyId: params.virtualKeyId } : {}),
      now,
      staleBefore: now.subtract({ milliseconds: REALTIME_OPEN_SESSION_WINDOW_MS }),
      closeReason: REALTIME_EXPIRY_CLOSE_REASON,
    });
  }
}

/** The span name a settled voice session appears under in the trace explorer. */
const SPAN_NAME = "realtime.session.settled";

/**
 * A span id derived from the session id rather than random. Settlement can be delivered more than
 * once — a resent webhook, a retried usage report, a cost-unknown settlement later confirmed — and
 * a stable id means each of those writes the same span, so a replay cannot inflate the cost.
 */
function settlementSpanId(sessionId: string): string {
  return createHash("sha256").update(`realtime-settlement:${sessionId}`).digest("hex").slice(0, 16);
}

function attr(
  key: string,
  value: string | number,
):
  | { key: string; value: { doubleValue: number } }
  | { key: string; value: { stringValue: string } } {
  return typeof value === "number"
    ? { key, value: { doubleValue: value } }
    : { key, value: { stringValue: value } };
}

/**
 * Records what a voice session used, in the trace the mint opened. Never throws: the money is
 * already on the spend record by the time this runs, so a failure here costs a visible number
 * rather than a charge, and raising would roll back an already-accepted settlement.
 */
async function recordRealtimeSessionSpan(params: {
  session: GatewayRealtimeSessionRecord;
  usage: SpendUsage;
  costNanoUsd: number;
  durationMs: number;
  occurredAt: Instant;
  /**
   * Absent on a deployment that composes no trace storage. The settlement
   * span is then not written, which is the honest answer: there is no trace
   * to write it into. The spend record is unaffected either way.
   */
  spanIngestion?: GatewaySpanIngestion | undefined;
}): Promise<void> {
  const { session } = params;
  // No trace means the mint predates the trace id being carried, or the
  // request arrived with no trace context. Inventing a trace here would put a
  // cost in the explorer under an id nothing else references.
  if (!session.traceId) {
    return;
  }

  const endMs = params.occurredAt.epochMilliseconds;
  const startMs = Math.max(0, endMs - Math.max(0, params.durationMs));
  // The canonical attribute names, the same ones the gateway's mint span
  // writes. The trace fold reads cost from `langwatch.span.cost` and tokens
  // from the `gen_ai.usage.*` keys; a name of our own would store fine and
  // then be ignored, leaving the span visible at no cost, which is the
  // failure this whole change exists to remove.
  const attributes = [
    attr(ATTR.SPAN_TYPE, "llm"),
    // The model the mint's span recorded, so one call is one model on the
    // trace surface. Falling back to the billing id keeps a session minted
    // before this was carried from losing its model entirely.
    attr(ATTR.GEN_AI_REQUEST_MODEL, session.requestedModel || session.model),
    attr(ATTR.GEN_AI_PROVIDER_NAME, session.vendor),
    // Priority 2 in the cost cascade: a cost the emitter worked out itself
    // wins over the registry estimate. This is the figure the spend record
    // carries, so the two surfaces state one number.
    attr(ATTR.LANGWATCH_SPAN_COST, params.costNanoUsd / 1_000_000_000),
    attr(ATTR.GEN_AI_USAGE_INPUT_TOKENS, params.usage.input_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_OUTPUT_TOKENS, params.usage.output_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_INPUT_AUDIO_TOKENS, params.usage.input_audio_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_OUTPUT_AUDIO_TOKENS, params.usage.output_audio_tokens ?? 0),
    attr(ATTR.GEN_AI_USAGE_AUDIO_SECONDS, (params.usage.audio_ms ?? 0) / 1000),
    attr("langwatch.virtual_key_id", session.virtualKeyId),
    attr("langwatch.gateway_request_id", session.id),
  ];

  try {
    // ingestNormalizedSpan, not the raw command — the seam both OTLP and REST
    // collectors route through, whose (tenant, trace, span) dedup gate makes
    // a resent webhook or retried usage report write this span once, not
    // twice. `traceIngestion`, not `traces`: App.traces is a read-only TraceModule,
    // and reaching for traces?.collection silently no-ops with no span written.
    if (!params.spanIngestion) {
      return;
    }

    await params.spanIngestion.ingestNormalizedSpan({
      tenantId: session.projectId,
      span: {
        traceId: session.traceId,
        spanId: settlementSpanId(session.id),
        name: SPAN_NAME,
        kind: 3,
        startTimeUnixNano: String(startMs * 1_000_000),
        endTimeUnixNano: String(endMs * 1_000_000),
        attributes,
        events: [],
        links: [],
        status: { message: null, code: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: null,
      instrumentationScope: null,
      piiRedactionLevel: DEFAULT_PII_REDACTION_LEVEL,
    });
  } catch (error) {
    logger.warn(
      { error, sessionId: session.id },
      "a voice session settled but its cost was not written to the trace; the spend record is unaffected",
    );
  }
}
