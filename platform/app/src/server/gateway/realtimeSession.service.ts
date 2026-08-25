/**
 * The record of brokered realtime voice sessions (ADR-097).
 *
 * The gateway holds no session state. A voice session outlives the request
 * that minted it, the vendor's post-call report lands on whichever replica
 * answers next, and the per-key open-session cap has to be counted somewhere
 * every replica sees. This service is that place.
 *
 * One session is one spend record. It is admitted when the credential is
 * minted, and confirmed here when the vendor says what the call used. A
 * session that never reports settles as cost-unknown at the spend grace, and
 * a report arriving after that supersedes the settled row.
 */

import type { GatewayRealtimeSessionRecord } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import type {
  GatewayRealtimeSession,
  GatewayRealtimeSessionStatus,
  Prisma,
} from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { prisma } from "~/server/db";
import {
  type ConfirmSpendCommandData,
  EMPTY_SPEND_USAGE,
  type SpendUsage,
} from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import { GATEWAY_SPEND_PIPELINE_NAME } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/constants";
import { rateSpendNanoUsd } from "~/server/event-sourcing/pipelines/gateway-spend-processing/services/spend-rating.service";
import { recordRealtimeSessionSpan } from "./realtimeSessionSpan";
import { parseVirtualKeyConfig } from "./virtualKey.config";

const logger = createLogger("langwatch:gateway:realtime-session");

/**
 * How far back the cap counts.
 *
 * OpenAI's realtime socket never signals that it closed, so a session opened
 * through it can only be closed by a usage report the client may never send.
 * Counting every OPEN row ever written would ratchet a key until it could
 * mint nothing at all. One hour is OpenAI's own maximum session length, so a
 * row older than that describes a call that cannot still be running.
 */
export const REALTIME_OPEN_SESSION_WINDOW_MS = 60 * 60 * 1000;

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
 * Books a session, deciding the per-key cap in the same transaction that
 * inserts the row.
 *
 * The advisory lock is what makes the cap a cap. Without it two mints racing
 * on the same key both read the count before either insert lands, and a key
 * limited to one holds two sessions. The lock is transaction scoped, so it
 * releases on commit or rollback with no cleanup path to forget.
 *
 * The limit is read here rather than carried from the gateway on purpose: the
 * count and the limit then come from the same read at the same instant, so a
 * cap edited a minute ago applies to this mint.
 */
export async function reserveRealtimeSession(
  input: ReserveInput,
): Promise<ReserveResult> {
  return prisma.$transaction(async (tx) => {
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
      await expireStaleRealtimeSessions({
        virtualKeyId: input.virtualKeyId,
        tx,
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
export async function correlateRealtimeSession(params: {
  sessionId: string;
  projectId: string;
  vendorConversationId: string;
}): Promise<boolean> {
  const updated = await prisma.gatewayRealtimeSession.updateMany({
    where: { id: params.sessionId, projectId: params.projectId },
    data: { vendorConversationId: params.vendorConversationId },
  });
  return updated.count > 0;
}

/** Closes a session that never opened, so the cap stops counting it. */
export async function releaseRealtimeSession(params: {
  sessionId: string;
  projectId: string;
  status: GatewayRealtimeSessionStatus;
  reason: string;
}): Promise<boolean> {
  const updated = await prisma.gatewayRealtimeSession.updateMany({
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
 * Finds the session a vendor's post-call report belongs to.
 *
 * Three ways, in order of how sure each is:
 *
 *  1. the vendor's own conversation id, recorded at the mint. Exact.
 *  2. the LangWatch session id the mint echoed into the conversation's own
 *     variables, when the vendor sends those back.
 *  3. the one session open for this credential inside the report's window.
 *
 * The third stops at exactly one candidate. Two open sessions in the same
 * window are indistinguishable from each other, and charging a call to the
 * wrong one is worse than leaving it unmatched: the unmatched call settles
 * visibly as cost-unknown, while a wrong match is a wrong bill that looks
 * right.
 */
export async function matchRealtimeSession(params: {
  vendor: string;
  organizationId: string;
  modelProviderId: string;
  vendorConversationId?: string;
  echoedSessionId?: string;
  callStartedAt?: Date;
}): Promise<GatewayRealtimeSession | null> {
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
    if (exact) return exact;
  }

  if (params.echoedSessionId) {
    const echoed = await prisma.gatewayRealtimeSession.findFirst({
      where: { ...tenancy, id: params.echoedSessionId },
    });
    if (echoed) return echoed;
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
  if (candidates.length === 1) return candidates[0] ?? null;
  logger.warn(
    { vendor: params.vendor, candidates: candidates.length },
    "a realtime post-call report matched no single open session; it settles as cost-unknown rather than being charged to a guess",
  );
  return null;
}

/**
 * Closes a session with what the vendor reported and confirms its spend.
 *
 * The confirmation is sent into the gateway spend pipeline exactly as the
 * gateway's own drainer would send it, so the fold applies it through the
 * same lattice: confirmed supersedes settled, and a redelivered report
 * collapses on the pipeline's own per-step idempotency key.
 *
 * Money is rated here, from quantities, by the one rating seam. The vendor's
 * own cost figure is stored beside it and never billed from: two systems
 * pricing the same call is how they come to disagree about it.
 */
export async function closeAndConfirmRealtimeSession(params: {
  session: GatewayRealtimeSessionRecord;
  usage: Partial<SpendUsage>;
  vendorCostRaw?: unknown;
  occurredAt?: Date;
  durationMs?: number;
  reason: string;
}): Promise<void> {
  const occurredAt = params.occurredAt ?? new Date();
  const usage: SpendUsage = { ...EMPTY_SPEND_USAGE, ...params.usage };

  // The confirmation goes first, and the row is closed only once it has
  // landed. The other order loses money: closing first and then failing to
  // confirm leaves a row that says the call was handled while its spend
  // record sits admitted until the grace settles it as unknown, and no
  // retry ever looks at it again because it is no longer open. Both steps
  // are idempotent, so a confirmation that lands twice is collapsed by the
  // pipeline's own per-step key and a second close is a no-op.
  const rated = rateSpendNanoUsd({ model: params.session.model, usage });
  await sendConfirmSpend({
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
    // surfaces can be joined. The rest is not known on this path: a brokered
    // call runs client to vendor, so no span reaches us, and the mint takes
    // no end-user header. The principal and the team are joined by the
    // ingest seam from the virtual key.
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
  });
}

/**
 * Closes one session with the usage a client read off its own socket.
 *
 * A second report on a session that is already CLOSED is a no-op that still
 * answers success. The gateway posts this from a customer's client, so a
 * retry or a replay is ordinary traffic, and confirming again would write a
 * second confirmation against one admission with a duration recomputed from
 * the mint, which grows on every replay.
 *
 * An EXPIRED session still confirms: the sweeper only decided the row was not
 * holding a cap slot, and a real report arriving afterwards is the truth
 * about what the call used.
 */
export async function reportRealtimeSessionUsage(params: {
  sessionId: string;
  projectId: string;
  virtualKeyId: string;
  usage: Partial<SpendUsage>;
  now?: Date;
}): Promise<"closed" | "already_closed" | "not_found"> {
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
  if (!session) return "not_found";
  if (session.status === "CLOSED" || session.status === "FAILED") {
    logger.info(
      { sessionId: session.id, status: session.status },
      "a realtime usage report arrived for a session that is no longer open",
    );
    return "already_closed";
  }

  const now = params.now ?? new Date();
  await closeAndConfirmRealtimeSession({
    session,
    usage: params.usage,
    occurredAt: now,
    reason: "usage reported by the client",
    durationMs: Math.max(0, now.getTime() - session.mintedAt.getTime()),
  });
  return "closed";
}

/**
 * Marks as EXPIRED the sessions no report ever closed.
 *
 * A row older than the window describes a call that cannot still be running,
 * so keeping it OPEN would hold a cap slot forever. Run under the same
 * advisory lock the cap count runs under, scoped to one key, so it costs one
 * bounded write on the mint that needed the slot rather than a scheduled
 * sweep over the whole table.
 *
 * The spend record is untouched. The settlement sweeper owns that side and
 * has its own grace, and a vendor report arriving after either of them still
 * supersedes what it finds.
 */
export async function expireStaleRealtimeSessions(params: {
  virtualKeyId?: string;
  now?: Date;
  tx?: Pick<typeof prisma, "gatewayRealtimeSession">;
}): Promise<number> {
  const now = params.now ?? new Date();
  const db = params.tx ?? prisma;
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

/**
 * Hands a confirmation to the gateway spend pipeline.
 *
 * Typed with the pipeline's own command data so a field renamed on the spend
 * wire fails this file at compile time. The pipeline registry is keyed by a
 * union this module is not part of, so reaching it needs a cast; the cast
 * stops at the lookup and the payload keeps its real type.
 */
async function sendConfirmSpend(data: ConfirmSpendCommandData): Promise<void> {
  const pipeline = getApp().eventSourcing?.getPipeline(
    GATEWAY_SPEND_PIPELINE_NAME as never,
  ) as
    | {
        commands: {
          confirmSpend?: {
            send: (d: ConfirmSpendCommandData) => Promise<unknown>;
          };
        };
      }
    | undefined;
  const send = pipeline?.commands?.confirmSpend?.send;
  if (!send) {
    throw new Error(
      "the gateway spend pipeline is not registered, so a voice session cannot be confirmed",
    );
  }
  await send(data);
}
