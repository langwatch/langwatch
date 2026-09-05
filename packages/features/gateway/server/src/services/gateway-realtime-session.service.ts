/**
 * @see ADR-097
 * The record of brokered realtime voice sessions. The gateway holds no session state — a session outlives its minting request, the vendor's report can land on any replica, and the per-key cap must be counted somewhere every replica sees; this service is that place. One session is one spend record: admitted at mint, confirmed here on report, settling cost-unknown at grace if none arrives (a late report supersedes the settled row).
 */

import type { GatewayRealtimeSessionRecord } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type {
  GatewayRealtimeSession,
  GatewayRealtimeSessionStatus,
  Prisma,
} from "@langwatch/prisma-client/generated";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { EMPTY_SPEND_USAGE, type SpendUsage } from "../processes/gateway-spend-commands.process";
import type { GatewaySpanIngestionPort } from "../ports/gateway-span-ingestion.port";
import type { GatewaySpendConfirmationPort } from "../ports/gateway-spend-confirmation.port";
import type { GatewaySpendRatingPort } from "../ports/gateway-spend-rating.port";
import { createHash } from "crypto";
import { ATTR_KEYS as ATTR, DEFAULT_PII_REDACTION_LEVEL } from "@langwatch/trace-contract";
import { parseVirtualKeyConfig } from "@langwatch/gateway-contract";

const logger = createLogger("langwatch:gateway:realtime-session");

/**
 * How far back the cap counts. OpenAI's realtime socket never signals close, so a session can only be closed by a usage report the client may never send — counting every OPEN row ever would ratchet a key to zero capacity. One hour is OpenAI's own max session length, so an older row can't still be running.
 */
export const REALTIME_OPEN_SESSION_WINDOW_MS = 60 * 60 * 1000;

/**
 * Everything this service reaches outside itself, named rather than resolved from a process singleton — the voice settlement writes money, and a second process quietly composing a second database or rating table would give two answers to what one call cost.
 */
export type GatewayRealtimeSessionCollaborators = {
  database: PrismaClient;
  /** Prices the vendor's quantities. The one rating seam for the vertical. */
  spendRating: GatewaySpendRatingPort;
  /** Sends the confirmation into the gateway spend pipeline. */
  spendConfirmation: GatewaySpendConfirmationPort;
  /**
   * Writes the settlement span. Absent where the deployment composes no trace
   * storage: the money still lands, the trace just carries no cost line.
   */
  spanIngestion?: GatewaySpanIngestionPort | undefined;
};

/** What a reserve attempt answers. */
export type ReserveResult =
  | { ok: true }
  | { ok: false; reason: "session_limit"; open: number; limit: number };

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
   * Books a session, deciding the per-key cap in the same transaction that inserts the row. The advisory lock is what makes the cap a cap — without it, two racing mints both read the count before either insert lands, and a key limited to one holds two sessions; transaction-scoped, so it releases on commit/rollback with nothing to forget. Limit is read here, not carried from the gateway, so count and limit come from the same instant and a cap edited a minute ago applies to this mint.
   */
  async reserveRealtimeSession(
    input: ReserveInput & { collaborators: GatewayRealtimeSessionCollaborators },
  ): Promise<ReserveResult> {
    return input.collaborators.database.$transaction(async (tx) => {
      // An advisory lock names no table and reads no row, so the raw-query
      // tenancy guard has nothing to check and is opted out of by name. The
      // lock key carries the tenancy itself: it is the project and the key
      // together, so two projects never contend and one key's mints serialize
      // against each other, which is what makes the count below a cap.
      const lockKey = `${input.projectId}:${input.virtualKeyId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})) -- @tenancy: a lock, not a read; the lock key is itself scoped to one project and key`;

      const key = await tx.virtualKey.findUnique({
        where: { id: input.virtualKeyId },
        select: { config: true },
      });
      const limit = parseVirtualKeyConfig(key?.config).realtime.maxOpenSessions;

      if (limit !== null) {
        // Expire this key's stale rows first, under the lock we already hold,
        // so the count and the table agree. A session no report ever closed
        // would otherwise sit OPEN forever and ratchet the key down one slot
        // at a time, which is the failure an OpenAI socket makes likely: it
        // never signals that it closed.
        await this.expireStaleRealtimeSessions({
          virtualKeyId: input.virtualKeyId,
          tx,
          collaborators: input.collaborators,
        });
        const open = await tx.gatewayRealtimeSession.count({
          where: { virtualKeyId: input.virtualKeyId, status: "OPEN" },
        });
        if (open >= limit) {
          return {
            ok: false as const,
            reason: "session_limit" as const,
            open,
            limit,
          };
        }
      }

      await tx.gatewayRealtimeSession.create({
        data: {
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
          status: "OPEN",
        },
      });

      return { ok: true as const };
    });
  }

  /** Records the vendor's own conversation id against a booked session. */
  async correlateRealtimeSession(params: {
    sessionId: string;
    projectId: string;
    vendorConversationId: string;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<boolean> {
    const updated = await params.collaborators.database.gatewayRealtimeSession.updateMany({
      where: { id: params.sessionId, projectId: params.projectId },
      data: { vendorConversationId: params.vendorConversationId },
    });

    return updated.count > 0;
  }

  /** Closes a session that never opened, so the cap stops counting it. */
  async releaseRealtimeSession(params: {
    sessionId: string;
    projectId: string;
    status: GatewayRealtimeSessionStatus;
    reason: string;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<boolean> {
    const updated = await params.collaborators.database.gatewayRealtimeSession.updateMany({
      where: {
        id: params.sessionId,
        projectId: params.projectId,
        status: "OPEN",
      },
      data: {
        status: params.status,
        closedAt: new Date(),
        closeReason: params.reason.slice(0, 256),
      },
    });

    return updated.count > 0;
  }

  /**
   * Finds the session a vendor's post-call report belongs to, three ways in order of certainty: (1) the vendor's own conversation id recorded at mint (exact); (2) the LangWatch session id echoed into the conversation's variables, if the vendor sends it back; (3) the one session open for this credential in the report's window — which stops at exactly one candidate, since two opens in the same window are indistinguishable and a wrong match (a wrong bill that looks right) is worse than an unmatched call settling visibly as cost-unknown.
   */
  async matchRealtimeSession(params: {
    vendor: string;
    organizationId: string;
    modelProviderId: string;
    vendorConversationId?: string;
    echoedSessionId?: string;
    callStartedAt?: Date;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<GatewayRealtimeSession | null> {
    const prisma = params.collaborators.database;
    // Every branch is scoped to the organization that owns the credential the
    // delivery was signed for. A conversation id is the vendor's, not ours, so
    // without that scope one tenant's delivery could name another's session.
    const tenancy = {
      organizationId: params.organizationId,
      vendor: params.vendor,
    };

    if (params.vendorConversationId) {
      const exact = await prisma.gatewayRealtimeSession.findFirst({
        where: { ...tenancy, vendorConversationId: params.vendorConversationId },
      });
      if (exact) {
        return exact;
      }
    }

    if (params.echoedSessionId) {
      const echoed = await prisma.gatewayRealtimeSession.findFirst({
        where: { ...tenancy, id: params.echoedSessionId },
      });
      if (echoed) {
        return echoed;
      }
    }

    const since = new Date(
      (params.callStartedAt?.getTime() ?? Date.now()) - REALTIME_OPEN_SESSION_WINDOW_MS,
    );
    const candidates = await prisma.gatewayRealtimeSession.findMany({
      where: {
        ...tenancy,
        modelProviderId: params.modelProviderId,
        status: "OPEN",
        mintedAt: { gt: since },
      },
      take: 2,
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
   * Closes a session with what the vendor reported and confirms its spend, sent into the gateway spend pipeline exactly as the gateway's own drainer would — the fold applies it through the same lattice (confirmed supersedes settled; a redelivered report collapses on the pipeline's own idempotency key). Money is rated here from quantities by the one rating seam; the vendor's own cost figure is stored beside it and never billed from, since two systems pricing one call is how they disagree.
   */
  async closeAndConfirmRealtimeSession(params: {
    session: GatewayRealtimeSessionRecord;
    usage: Partial<SpendUsage>;
    vendorCostRaw?: unknown;
    occurredAt?: Date;
    durationMs?: number;
    reason: string;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<void> {
    const prisma = params.collaborators.database;
    const occurredAt = params.occurredAt ?? new Date();
    const usage: SpendUsage = { ...EMPTY_SPEND_USAGE, ...params.usage };

    // Confirmation goes first; the row closes only once it has landed — the
    // other order loses money (closing then failing to confirm leaves a row
    // saying "handled" while its spend sits admitted until grace settles it
    // unknown, and no retry looks at it again since it's no longer open).
    // Both steps are idempotent, so a repeat confirm/close is a no-op.
    const rated = params.collaborators.spendRating.rate({
      model: params.session.model,
      usage,
    });
    await params.collaborators.spendConfirmation.confirmSpend({
      gateway_request_id: params.session.id,
      occurred_at: occurredAt.getTime(),
      tenantId: params.session.projectId,
      model: params.session.model,
      model_provider_id: params.session.modelProviderId,
      usage,
      cost_nano_usd: rated.costNanoUsd,
      rate_version: rated.rateVersion,
      duration_ms: params.durationMs ?? 0,
      // Attribution. A voice confirmation is emitted here rather than by the
      // gateway, so it has to carry what the gateway would have carried; the
      // session row recorded it at the mint.
      organization_id: params.session.organizationId,
      virtual_key_id: params.session.virtualKeyId,
      request_type: "realtime_session",
      admitted_at: params.session.mintedAt.getTime(),
      // The mint recorded its own trace id on the session row, so the spend
      // record and the settlement span name the same trace and the two money
      // surfaces can be joined. A brokered call runs client to vendor, so no
      // span reaches us and the mint takes no end-user header; principal and
      // team are joined by the ingest seam from the virtual key.
      end_user_id: "",
      trace_id: params.session.traceId ?? "",
      principal_user_id: "",
      team_id: "",
      labels: [],
      metadata: "",
    });

    const closed = await prisma.gatewayRealtimeSession.updateMany({
      where: {
        id: params.session.id,
        projectId: params.session.projectId,
        status: { in: ["OPEN", "EXPIRED"] },
      },
      data: {
        status: "CLOSED",
        closedAt: occurredAt,
        closeReason: params.reason.slice(0, 256),
        ...(params.vendorCostRaw === undefined
          ? {}
          : { vendorCostRaw: params.vendorCostRaw as Prisma.InputJsonValue }),
      },
    });
    if (closed.count === 0) {
      logger.info(
        { sessionId: params.session.id },
        "a realtime report arrived for a session that was already closed",
      );

      return;
    }

    // One session, one span, emitted by whichever confirmation won the close.
    // Gating on the close is what makes it exactly once: a resent webhook, a
    // retried client report, or a late confirmation superseding a settled
    // record all find the row already CLOSED and add nothing to the trace.
    await recordRealtimeSessionSpan({
      session: params.session,
      usage,
      costNanoUsd: rated.costNanoUsd,
      durationMs: params.durationMs ?? 0,
      occurredAt,
      spanIngestion: params.collaborators.spanIngestion,
    });
  }

  /**
   * Closes one session with usage a client read off its own socket. A second report on an already-CLOSED session is a success no-op (the gateway posts this from a customer's client, so retries/replays are ordinary traffic, and re-confirming would grow duration on every replay). An EXPIRED session still confirms — the sweeper only decided it wasn't holding a cap slot, and a real report afterwards is the truth about what the call used.
   */
  async reportRealtimeSessionUsage(params: {
    sessionId: string;
    projectId: string;
    virtualKeyId: string;
    usage: Partial<SpendUsage>;
    now?: Date;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<"closed" | "already_closed" | "not_found"> {
    const prisma = params.collaborators.database;
    // Matched on the key as well as the project. A trace project is shared by
    // every key scoped to it, so filtering on the project alone would let the
    // holder of one key close a session another key opened and write arbitrary
    // usage onto that key's admitted spend record. A session id is a
    // gateway request id, which the other key's own response header carries.
    const session = await prisma.gatewayRealtimeSession.findFirst({
      where: {
        id: params.sessionId,
        projectId: params.projectId,
        virtualKeyId: params.virtualKeyId,
      },
    });
    if (!session) {
      return "not_found";
    }

    if (session.status === "CLOSED" || session.status === "FAILED") {
      logger.info(
        { sessionId: session.id, status: session.status },
        "a realtime usage report arrived for a session that is no longer open",
      );

      return "already_closed";
    }

    const now = params.now ?? new Date();
    await this.closeAndConfirmRealtimeSession({
      session,
      usage: params.usage,
      occurredAt: now,
      collaborators: params.collaborators,
      reason: "usage reported by the client",
      durationMs: Math.max(0, now.getTime() - session.mintedAt.getTime()),
    });

    return "closed";
  }

  /**
   * Marks as EXPIRED the sessions no report ever closed — an older-than-window row can't still be running, so leaving it OPEN would hold a cap slot forever. Runs under the same advisory lock the cap count uses, scoped to one key, so it costs one bounded write on the mint needing the slot rather than a table-wide sweep. Spend record is untouched (the settlement sweeper owns that side, with its own grace); a later vendor report still supersedes what either finds.
   */
  async expireStaleRealtimeSessions(params: {
    virtualKeyId?: string;
    now?: Date;
    tx?: Pick<PrismaClient, "gatewayRealtimeSession">;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<number> {
    const now = params.now ?? new Date();
    const db = params.tx ?? params.collaborators.database;
    const { count } = await db.gatewayRealtimeSession.updateMany({
      where: {
        ...(params.virtualKeyId ? { virtualKeyId: params.virtualKeyId } : {}),
        status: "OPEN",
        mintedAt: {
          lt: new Date(now.getTime() - REALTIME_OPEN_SESSION_WINDOW_MS),
        },
      },
      data: {
        status: "EXPIRED",
        closedAt: now,
        closeReason: "no vendor report arrived within the longest possible call",
      },
    });

    return count;
  }
}

/** The span name a settled voice session appears under in the trace explorer. */
const SPAN_NAME = "realtime.session.settled";

/**
 * A span id derived from the session id, not random — settlement can be delivered more than once (resent webhook, retried usage report, a cost-unknown settlement later confirmed), and a stable id means every one of those writes the same span instead of adding another, so a replay can't inflate the trace's cost.
 */
function settlementSpanId(sessionId: string): string {
  return createHash("sha256").update(`realtime-settlement:${sessionId}`).digest("hex").slice(0, 16);
}

function attr(key: string, value: string | number) {
  return typeof value === "number"
    ? { key, value: { doubleValue: value } }
    : { key, value: { stringValue: value } };
}

/**
 * Records what a voice session used, in the trace the mint opened. Never throws: the money is already recorded on the spend record by the time this runs, so a failure here costs a visible number, not a charge, and raising would roll back an already-accepted settlement.
 */
async function recordRealtimeSessionSpan(params: {
  session: GatewayRealtimeSessionRecord;
  usage: SpendUsage;
  costNanoUsd: number;
  durationMs: number;
  occurredAt: Date;
  /**
   * Absent on a deployment that composes no trace storage. The settlement
   * span is then not written, which is the honest answer: there is no trace
   * to write it into. The spend record is unaffected either way.
   */
  spanIngestion?: GatewaySpanIngestionPort | undefined;
}): Promise<void> {
  const { session } = params;
  // No trace means the mint predates the trace id being carried, or the
  // request arrived with no trace context. Inventing a trace here would put a
  // cost in the explorer under an id nothing else references.
  if (!session.traceId) {
    return;
  }

  const endMs = params.occurredAt.getTime();
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
    // twice. `traceIngestion`, not `traces`: App.traces is a read-only TraceApp,
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
