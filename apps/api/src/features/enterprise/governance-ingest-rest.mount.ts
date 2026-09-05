/**
 * The API process's Activity Monitor receivers.
 */
import type {
  GovernanceIngestRestPorts,
  GovernanceIngestTraceCollectionPort,
} from "@langwatch/enterprise-governance-server";
import {
  GovernanceIngestKeyProvenancePort,
  GovernanceIngestRateLimitPort,
} from "@langwatch/enterprise-governance-server";
import {
  INGEST_RATE_LIMIT_MAX_REQUESTS,
  INGEST_RATE_LIMIT_WINDOW_SECONDS,
} from "@langwatch/enterprise-governance-server";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GovernanceInternalProjectPort } from "@langwatch/project-server";
import {
  enforceApiKeyIdOnLogRequest,
  enforceApiKeyIdOnMetricRequest,
  enforceApiKeyIdOnTraceRequest,
} from "@langwatch/trace-server";

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
   * The same counter every other throttle on this process meters through, so one caller
   * has one budget per rule rather than two.
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

/**
 * The trace receiver's own API-key attribution rule, handed to the governance receivers
 * rather than restated by them.
 */
export class ApiGovernanceIngestKeyProvenance extends GovernanceIngestKeyProvenancePort {
  static create(): ApiGovernanceIngestKeyProvenance {
    return new ApiGovernanceIngestKeyProvenance();
  }

  dropOnTraceRequest(request: unknown): void {
    enforceApiKeyIdOnTraceRequest(
      request as Parameters<typeof enforceApiKeyIdOnTraceRequest>[0],
      null,
    );
  }

  dropOnLogRequest(request: unknown): void {
    enforceApiKeyIdOnLogRequest(request as Parameters<typeof enforceApiKeyIdOnLogRequest>[0], null);
  }

  dropOnMetricRequest(request: unknown): void {
    enforceApiKeyIdOnMetricRequest(
      request as Parameters<typeof enforceApiKeyIdOnMetricRequest>[0],
      null,
    );
  }
}

export type ApiGovernanceIngestRestOptions = Readonly<{
  /** The Enterprise governance capability, where the deployment composed one. */
  governance: GovernanceService | undefined;
  /** The internal governance project mint; `ProjectService` satisfies it. */
  projects: Pick<GovernanceInternalProjectPort, "ensureInternal"> | undefined;
  /**
   * The trace collection the OTLP receiver composed, or none. Taken rather than built: it
   * carries this process's single `trace_processing` producer registration, and a second
   * one would describe the same event stream twice.
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
 * Composes the receiver ports, or none. Absent without the governance capability, the
 * project mint, the trace collection or the database.
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
    keyProvenance: ApiGovernanceIngestKeyProvenance.create(),
  };
}
