/**
 * @see ADR-097
 * Usage reports of a realtime voice session. Each report is confirmed as its own spend record,
 * so every budget on the key's chain is debited while the call runs, and a session that never
 * reports is settled at an estimate rather than at nothing.
 */
import { createHash } from "crypto";

import {
  NANO_USD_PER_USD,
  type GatewayRealtimeBudgetVerdict,
  type GatewayRealtimeMetering,
  type GatewayRealtimeSession,
  type GatewayRealtimeUsageReceipt,
  type SpendUsage,
} from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { nowInstant, type Instant } from "@langwatch/time";

import {
  estimateUnreportedRealtimeUsage,
  isEmptyRealtimeUsage,
  realtimeReportSpendRecordId,
  REALTIME_BUDGET_READ_TIMEOUT_MS,
  REALTIME_ESTIMATE_REPORT_KEY,
  REALTIME_FINAL_REPORT_KEY,
  REALTIME_LEDGER_LAG_MS,
  REALTIME_REPORT_REQUEST_TYPE,
  remainingRealtimeUsage,
  sanitiseRealtimeReportKey,
  sumRealtimeUsage,
  type RealtimeUsageEstimate,
} from "../rules/gateway-realtime-session-metering.rules.ts";
import { EMPTY_SPEND_USAGE } from "../rules/gateway-spend-projection.rules.ts";
import {
  GatewayRealtimeSessionService,
  type GatewayRealtimeSessionAttribution,
  type GatewayRealtimeSessionCollaborators,
} from "./gateway-realtime-session.service.ts";

const logger = createLogger("langwatch:gateway:realtime-session-metering");

/** Why a session closed by the sweep rather than by its own closing report says it closed. */
export const REALTIME_SETTLEMENT_REASONS = {
  reported: "closed by window; reported usage stands",
  estimated: "estimated: no usage report arrived",
  orphaned: "gateway lost the session; closed at recorded usage",
} as const;

type RecordedReport = { status: "recorded" | "duplicate"; costNanoUsd: number };

export class GatewayRealtimeSessionMeteringService {
  static create(): GatewayRealtimeSessionMeteringService {
    return new GatewayRealtimeSessionMeteringService(GatewayRealtimeSessionService.create());
  }

  private constructor(private readonly sessions: GatewayRealtimeSessionService) {}

  /**
   * Records one usage report. A keyed report is one spend record and leaves the session open
   * unless it is final. A report with no key and no `final` is the session total: what the keyed
   * reports have not already recorded is confirmed on the session's own record, which closes it.
   */
  async reportRealtimeSessionUsage(params: {
    sessionId: string;
    projectId: string;
    virtualKeyId: string;
    usage?: Partial<SpendUsage>;
    reportKey?: string;
    model?: string;
    pricedAs?: "transcription";
    final?: boolean;
    durationMs?: number;
    source?: GatewayRealtimeMetering;
    now?: Instant;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<GatewayRealtimeUsageReceipt | "not_found"> {
    const { collaborators } = params;
    // Matched on the key as well as the project: a project's keys share it, and a session id
    // is a gateway request id another key's response header carries, so the project alone
    // would let one key write usage onto a session another key opened.
    const session = await collaborators.sessions.findForReport({
      sessionId: params.sessionId,
      projectId: params.projectId,
      virtualKeyId: params.virtualKeyId,
    });
    if (!session) return "not_found";

    const now = params.now ?? nowInstant();
    const attribution = await this.sessions.findRealtimeSessionAttribution({
      session,
      collaborators,
    });
    const receipt = async (
      status: GatewayRealtimeUsageReceipt["status"],
      moved: { costNanoUsd: number; ownRecordNanoUsd?: number },
    ): Promise<GatewayRealtimeUsageReceipt> => ({
      status,
      costNanoUsd: moved.costNanoUsd,
      sessionCostNanoUsd: session.reportedCostNanoUsd + moved.costNanoUsd,
      budget: await this.budgetVerdict({
        session,
        attribution,
        now,
        unreportedNanoUsd: moved.ownRecordNanoUsd ?? 0,
        collaborators,
      }),
    });

    if (session.status === "CLOSED" || session.status === "FAILED") {
      logger.info(
        { sessionId: session.id, status: session.status },
        "a realtime usage report arrived for a session that is no longer open",
      );

      return receipt("already_closed", { costNanoUsd: 0 });
    }

    const usage = params.usage ?? {};
    // A closing report that carries usage and names no key is the `final` report.
    const keyed =
      params.reportKey !== undefined || (params.final === true && !isEmptyRealtimeUsage({ usage }));
    const durationMs =
      params.durationMs ?? Math.max(0, now.epochMilliseconds - session.mintedAt.epochMilliseconds);

    if (keyed) {
      const recorded = await this.recordReport({
        session,
        reportKey: storedReportKey({ reportKey: params.reportKey ?? REALTIME_FINAL_REPORT_KEY }),
        usage,
        model: reportModelOf({ session, model: params.model, pricedAs: params.pricedAs }),
        attribution,
        now,
        collaborators,
      });
      const moved = { costNanoUsd: recorded.status === "recorded" ? recorded.costNanoUsd : 0 };
      if (!params.final) return receipt(recorded.status, moved);

      await this.sessions.closeAndConfirmRealtimeSession({
        session,
        usage: {},
        occurredAt: now,
        durationMs,
        reason: closeReasonOf(params.source),
        attribution,
        collaborators,
      });

      return receipt("closed", moved);
    }

    // The session total, or a bare close. Reports are read only when some were recorded, so
    // a session that never sent one closes on exactly the read path it always did.
    const reports =
      session.reportCount > 0
        ? await collaborators.sessions.findReports({
            sessionId: session.id,
            projectId: session.projectId,
          })
        : [];
    const closed = await this.sessions.closeAndConfirmRealtimeSession({
      session,
      usage: remainingRealtimeUsage({
        total: usage,
        reported: sumRealtimeUsage({ usages: reports.map((report) => report.usage) }),
      }),
      occurredAt: now,
      durationMs,
      reason: closeReasonOf(params.source),
      attribution,
      reports,
      collaborators,
    });
    const ownRecordNanoUsd = closed.closed ? closed.costNanoUsd : 0;

    return receipt("closed", { costNanoUsd: ownRecordNanoUsd, ownRecordNanoUsd });
  }

  /**
   * Settles a metered session nothing closed. One the client meters that never reported is
   * charged an estimate; any other closes at what its reports recorded, since the gateway
   * recorded every response it saw and a client that reported is taken at its word.
   */
  async settleUnreportedRealtimeSession(params: {
    session: GatewayRealtimeSession;
    reason?: string;
    now?: Instant;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<"estimated" | "closed"> {
    const { session, collaborators } = params;
    const now = params.now ?? nowInstant();
    const attribution = await this.sessions.findRealtimeSessionAttribution({
      session,
      collaborators,
    });
    const estimate: RealtimeUsageEstimate =
      session.metering === "client" && session.reportCount === 0
        ? estimateUnreportedRealtimeUsage({
            kind: session.kind,
            mintedAtMs: session.mintedAt.epochMilliseconds,
            credentialExpiresAtMs: session.credentialExpiresAt?.epochMilliseconds ?? null,
          })
        : { estimated: false };
    if (estimate.estimated) {
      await this.recordReport({
        session,
        reportKey: REALTIME_ESTIMATE_REPORT_KEY,
        usage: estimate.usage,
        model: session.model,
        attribution,
        now,
        collaborators,
      });
    }

    const lastHeardMs = (session.lastReportAt ?? session.mintedAt).epochMilliseconds;
    await this.sessions.closeAndConfirmRealtimeSession({
      session,
      usage: {},
      occurredAt: now,
      durationMs: estimate.estimated
        ? estimate.durationMs
        : Math.max(0, lastHeardMs - session.mintedAt.epochMilliseconds),
      reason:
        params.reason ??
        (estimate.estimated
          ? REALTIME_SETTLEMENT_REASONS.estimated
          : REALTIME_SETTLEMENT_REASONS.reported),
      attribution,
      collaborators,
    });

    return estimate.estimated ? "estimated" : "closed";
  }

  /**
   * Confirms a report as its own spend record, then stores it. The confirmation goes first and
   * collapses on its id, so a crash between the two replays safely; a key already stored is
   * answered without confirming again, so a redelivery cannot restate what the first one said.
   */
  private async recordReport(params: {
    session: GatewayRealtimeSession;
    reportKey: string;
    usage: Partial<SpendUsage>;
    model: string;
    attribution: GatewayRealtimeSessionAttribution;
    now: Instant;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<RecordedReport> {
    const { session, reportKey, collaborators } = params;
    const stored = await collaborators.sessions.findReport({
      sessionId: session.id,
      projectId: session.projectId,
      reportKey,
    });
    if (stored) return { status: "duplicate", costNanoUsd: stored.costNanoUsd };

    const usage: SpendUsage = { ...EMPTY_SPEND_USAGE, ...params.usage };
    const rated = collaborators.spendRating.rate({ model: params.model, usage });
    await this.sessions.confirmRealtimeSpend({
      session,
      gatewayRequestId: realtimeReportSpendRecordId({ sessionId: session.id, reportKey }),
      requestType: REALTIME_REPORT_REQUEST_TYPE,
      model: params.model,
      usage,
      rated,
      durationMs: 0,
      occurredAt: params.now,
      attribution: params.attribution,
      collaborators,
    });
    const inserted = await collaborators.sessions.recordReport({
      report: {
        sessionId: session.id,
        projectId: session.projectId,
        reportKey,
        model: params.model,
        usage,
        costNanoUsd: rated.costNanoUsd,
        recordedAt: params.now,
      },
    });

    return { status: inserted ? "recorded" : "duplicate", costNanoUsd: rated.costNanoUsd };
  }

  /**
   * Whether a blocking budget on the key's chain is at or past its limit. The ledger is debited
   * a moment after a report is confirmed, so the session's recent reports are counted on top of
   * what it holds. Bounded: a read that fails or runs long answers unknown, never a guess.
   */
  private async budgetVerdict(params: {
    session: GatewayRealtimeSession;
    attribution: GatewayRealtimeSessionAttribution;
    now: Instant;
    unreportedNanoUsd: number;
    collaborators: GatewayRealtimeSessionCollaborators;
  }): Promise<GatewayRealtimeBudgetVerdict> {
    const { session, collaborators } = params;
    const budgets = collaborators.budgets;
    if (!budgets) return { exceeded: false, unknown: true };

    const read = async (): Promise<GatewayRealtimeBudgetVerdict> => {
      const recentNanoUsd = await collaborators.sessions.sumReportCostSince({
        sessionId: session.id,
        projectId: session.projectId,
        since: params.now.subtract({ milliseconds: REALTIME_LEDGER_LAG_MS }),
      });
      const pendingNanoUsd = recentNanoUsd + params.unreportedNanoUsd;
      const check = await budgets.checkBudget({
        organizationId: session.organizationId,
        teamId: params.attribution.teamId,
        projectId: session.projectId,
        virtualKeyId: session.virtualKeyId,
        principalUserId: params.attribution.principalUserId,
        projectedCostUsd: (pendingNanoUsd / NANO_USD_PER_USD).toFixed(9),
        providerKey: session.modelProviderId || null,
      });
      const [blocking] = check.blockedBy;

      return blocking
        ? { exceeded: true, scope: blocking.scope, budgetId: blocking.budgetId }
        : { exceeded: false };
    };

    try {
      return await settleWithin({ work: read(), timeoutMs: REALTIME_BUDGET_READ_TIMEOUT_MS });
    } catch (error) {
      logger.warn(
        { error, sessionId: session.id },
        "the budget read for a realtime usage report failed or ran long; the verdict is unknown",
      );

      return { exceeded: false, unknown: true };
    }
  }
}

/** The key a report is stored under; one with no storable character keeps its own identity. */
function storedReportKey({ reportKey }: { reportKey: string }): string {
  return (
    sanitiseRealtimeReportKey({ reportKey }) ||
    `k${createHash("sha256").update(reportKey).digest("hex").slice(0, 32)}`
  );
}

/** The catalog id a report is priced under: the one it names, else what it is priced as. */
function reportModelOf({
  session,
  model,
  pricedAs,
}: {
  session: GatewayRealtimeSession;
  model: string | undefined;
  pricedAs: "transcription" | undefined;
}): string {
  if (model) return model;

  return pricedAs === "transcription" ? session.transcriptionModel || session.model : session.model;
}

function closeReasonOf(source: GatewayRealtimeMetering | undefined): string {
  return source === "gateway" ? "usage reported by the gateway" : "usage reported by the client";
}

/** Resolves with `work`, or rejects once `timeoutMs` has passed. */
async function settleWithin<T>({
  work,
  timeoutMs,
}: {
  work: Promise<T>;
  timeoutMs: number;
}): Promise<T> {
  const signal = AbortSignal.timeout(timeoutMs);
  const timedOut = new Promise<never>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });

  return Promise.race([work, timedOut]);
}
