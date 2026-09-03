/**
 * The API process's Activity Monitor receivers.
 *
 * Behaviour is package-owned (`@langwatch/enterprise-governance-server`); this
 * binds the four collaborators the receivers reach — the governance capability
 * that resolves a source's secret, the internal governance project every write
 * is tenanted under, the trace pipeline the spans go to, and the per-caller
 * throttle.
 *
 * ## The trace pipeline is the SAME one, not a second one
 *
 * `traceCollection` is bound to the `traces` port
 * `api-trace-ingest.composition.ts` already built, which sends on this
 * process's own producer registration of `trace_processing`. Registering a
 * second copy of that definition would put one aggregate in the event
 * catalogue twice and give the worker two descriptions of one stream, so the
 * receiver joins the existing registration rather than making one — which is
 * also why this mount is absent wherever the OTLP receiver is.
 *
 * ## Named absences
 *
 * - **The LOG and METRIC signals are not served.** This process composes
 *   neither fold — the same absence the project-scoped OTLP receiver reports —
 *   so `POST /api/ingest/webhook/:sourceId` and the two `/v1/{logs,metrics}`
 *   sub-paths are NOT REGISTERED. An exporter gets a 404 from a receiver that
 *   honestly does not serve them rather than a 500 from one that pretends to.
 *   Only `POST /api/ingest/otel/:sourceId` is mounted here.
 * - **Nothing is priced.** The gateway spend ledger and its change feed are
 *   the gateway group's, which this process does not compose. Cost extraction
 *   lives on the `/v1/logs` route, which is unmounted anyway, so the absence
 *   costs nothing today and is declared for the deployment that mounts it.
 * - **The whole family is absent without an Enterprise application.** These
 *   receivers ARE governance ingestion, and a source secret this process
 *   cannot resolve would make every receiver answer 401 to correctly
 *   configured collectors.
 */
import type {
  GovernanceIngestRestPorts,
  GovernanceIngestTraceCollectionPort,
} from "@langwatch/enterprise-governance-server";
import { GovernanceIngestRateLimitPort } from "@langwatch/enterprise-governance-server";
import {
  INGEST_RATE_LIMIT_MAX_REQUESTS,
  INGEST_RATE_LIMIT_WINDOW_SECONDS,
} from "@langwatch/enterprise-governance-server";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GovernanceInternalProjectPort } from "@langwatch/project-server";

/** The process's ONE fixed-window counter, as the ingest throttle. */
export class ApiGovernanceIngestRateLimit extends GovernanceIngestRateLimitPort {
  static create(
    consume: (input: {
      key: string;
      windowSeconds: number;
      max: number;
    }) => Promise<{ allowed: boolean; resetAt: number }>,
  ): ApiGovernanceIngestRateLimit {
    return new ApiGovernanceIngestRateLimit(consume);
  }

  private constructor(
    private readonly consume: (input: {
      key: string;
      windowSeconds: number;
      max: number;
    }) => Promise<{ allowed: boolean; resetAt: number }>,
  ) {
    super();
  }

  /**
   * The same counter every other throttle on this process meters through, so
   * one caller has one budget per rule rather than two.
   *
   * `resetAt` is a wall-clock instant, and `Retry-After` is a duration, so it
   * is turned into the remaining seconds — floored at one, because answering
   * "retry in 0 seconds" invites the retry the refusal exists to delay.
   */
  async check(input: { ip: string }): Promise<{ allowed: boolean; retryAfterSec: number }> {
    const decision = await this.consume({
      key: `lwingest:rate:${input.ip}`,
      windowSeconds: INGEST_RATE_LIMIT_WINDOW_SECONDS,
      max: INGEST_RATE_LIMIT_MAX_REQUESTS,
    });
    if (decision.allowed) return { allowed: true, retryAfterSec: 0 };
    const remainingMs = decision.resetAt - Date.now();
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)),
    };
  }
}

export type ApiGovernanceIngestRestOptions = Readonly<{
  /** The Enterprise governance capability, where the deployment composed one. */
  governance: GovernanceService | undefined;
  /** The internal governance project mint; `ProjectService` satisfies it. */
  projects: Pick<GovernanceInternalProjectPort, "ensureInternal"> | undefined;
  /**
   * The trace collection the OTLP receiver composed, or none.
   *
   * Taken rather than built: it carries this process's single
   * `trace_processing` producer registration, and a second one would describe
   * the same event stream twice.
   */
  traceCollection: GovernanceIngestTraceCollectionPort | undefined;
  /** The process's one guarded connection, or none. */
  prisma: PrismaClient | undefined;
  /** The process's ONE fixed-window counter. */
  rateLimit: (input: {
    key: string;
    windowSeconds: number;
    max: number;
  }) => Promise<{ allowed: boolean; resetAt: number }>;
}>;

/**
 * Composes the receiver ports, or none.
 *
 * Absent without the governance capability, the project mint, the trace
 * collection or the database. The trace collection is the one that makes the
 * family pointless without it: a receiver that resolves a source and then has
 * nowhere to put its spans answers 202 to data it drops, which is the single
 * failure a collector can neither detect nor retry.
 */
export function composeApiGovernanceIngestRest(
  options: ApiGovernanceIngestRestOptions,
): GovernanceIngestRestPorts | undefined {
  const { governance, projects, traceCollection, prisma } = options;
  if (!governance || !projects || !traceCollection || !prisma) return undefined;

  return {
    governance: () => governance,
    projects: () => projects,
    traceCollection,
    database: () => prisma,
    rateLimit: ApiGovernanceIngestRateLimit.create(options.rateLimit),
  };
}
