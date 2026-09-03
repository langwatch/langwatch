import type {
  GovernanceHttpResponse,
  PulledUsageRateInput,
} from "@langwatch/enterprise-governance-server";
import {
  GovernanceIngestionPullHost,
  type GovernanceHttpRequest,
} from "@langwatch/enterprise-api/governance/ingestion-pull-worker.adapter";
import type {
  GovernanceIngestionPullMetricsPort,
  GovernanceIngestionPullSchedulePort,
} from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import type { GovernanceEncryption } from "@langwatch/enterprise-api/governance/governance-infrastructure.adapter";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import { computeNextRunAt } from "@langwatch/eventing/server";
import {
  estimateModelCost,
  getStaticModelCostRates,
  llmModels,
} from "@langwatch/model-provider-contract";
import { counter, histogram, type CounterHandle, type HistogramHandle } from "@langwatch/observability/metrics";
import { createLogger, type Logger } from "@langwatch/observability";

const NANO_USD_PER_USD = 1_000_000_000;

/** The two series names the App writes for the same measurements, pinned. */
export const INGESTION_PULL_TOTAL_METRIC_NAME = "ingestion_pull_total";
export const INGESTION_PULL_DURATION_METRIC_NAME = "ingestion_pull_duration_milliseconds";

/**
 * How a torn URL reaches the world, fenced.
 *
 * A port rather than a bare `fetch`, because an ingestion source is a URL the
 * CUSTOMER typed: the pull walks it on a schedule, from inside the cluster,
 * with the customer's own credentials attached. A process that composed this
 * with an unfenced fetch would let an ingestion source address the instance
 * metadata endpoint.
 */
export abstract class GovernanceIngestionEgressPort {
  abstract fetch(url: string, init: GovernanceHttpRequest): Promise<GovernanceHttpResponse>;
}

/** The AWS client shape the S3-polling puller is configured with. */
export abstract class GovernanceIngestionAwsPort {
  abstract build(input: {
    region?: string;
    targetHost: string;
    endpoint?: string;
    staticCredentials?: {
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
    };
  }): ReturnType<GovernanceIngestionPullHost["buildAwsClientConfig"]>;
}

export type WorkerGovernanceIngestionPullHostOptions = {
  egress: GovernanceIngestionEgressPort;
  aws: GovernanceIngestionAwsPort;
  /**
   * The cipher the App wrote a source's credentials with.
   *
   * A WIRE FORMAT, not a choice: an ingestion source's API token is stored by
   * the control plane and read here, so a second cipher would not fail — it
   * would decrypt to noise and the pull would authenticate with garbage.
   */
  encryption: GovernanceEncryption;
  featureFlags: Pick<FeatureFlagService, "isEnabled">;
  logger?: Logger;
};

/**
 * Worker-process infrastructure for the canonical ingestion-pull worker.
 *
 * Moved from the application, where the same five members were bound to
 * process globals: an SSRF-safe fetch, the shared AWS client factory, the
 * platform cipher, the feature-flag service and an error sink. Each is a port
 * here, because the worker holds each of them already and holds them once.
 *
 * RATING PRICES FROM THE STATIC CATALOG, exactly as the App's does — the App
 * reaches it through `rateSpendNanoUsd`'s `matchModelCostWithFallbacks` +
 * `estimateCost` pair, and this reaches the same rates through the one
 * canonical cascade both graphs' span pricing already uses. Pulled usage
 * reports four token quantities and no per-request attributes, so they are
 * handed in as the attribute record the cascade reads and the answer is the
 * same integer nano-USD. A second rate table would bill one customer two
 * different amounts for the same tokens depending on which process pulled
 * them.
 */
export class WorkerGovernanceIngestionPullHost extends GovernanceIngestionPullHost {
  static create(
    options: WorkerGovernanceIngestionPullHostOptions,
  ): WorkerGovernanceIngestionPullHost {
    return new WorkerGovernanceIngestionPullHost(options);
  }

  private readonly logger: Logger;
  readonly encryption: GovernanceEncryption;

  private constructor(private readonly options: WorkerGovernanceIngestionPullHostOptions) {
    super();
    this.logger = options.logger ?? createLogger("langwatch:governance:ingestion-pull");
    this.encryption = options.encryption;
  }

  fetch(url: string, init: GovernanceHttpRequest): Promise<GovernanceHttpResponse> {
    return this.options.egress.fetch(url, init);
  }

  ratePulledUsage(input: PulledUsageRateInput): { costNanoUsd: number; rateVersion: string } {
    const usd = estimateModelCost(
      {
        attrs: {
          "gen_ai.usage.cache_read_input_tokens": input.quantities.tokensCacheRead,
          "gen_ai.usage.cache_creation_input_tokens": input.quantities.tokensCacheWrite,
        } as never,
        model: input.model,
        promptTokens: input.quantities.tokensInput,
        completionTokens: input.quantities.tokensOutput,
      },
      getStaticModelCostRates(),
    );
    return {
      costNanoUsd: Math.round(usd * NANO_USD_PER_USD),
      rateVersion: currentRegistryRateVersion(),
    };
  }

  isPulledUsageCostEnabled(organizationId: string): Promise<boolean> {
    return this.options.featureFlags.isEnabled("release_pulled_usage_cost_enabled", {
      kind: "organization",
      organizationId,
    });
  }

  /**
   * A structured log rather than an error-tracker report.
   *
   * The App captures these into PostHog; this process has no error tracker of
   * its own, and inventing a second destination would split one failure mode
   * across two places an operator has to know to look in. The log carries the
   * same context object, which is what the capture carried.
   */
  capture(error: Error, context: Record<string, unknown>): void {
    this.logger.error({ ...context, error }, "governance ingestion pull failed");
  }

  buildAwsClientConfig(input: {
    region?: string;
    targetHost: string;
    endpoint?: string;
    staticCredentials?: {
      accessKeyId?: string;
      secretAccessKey?: string;
      sessionToken?: string;
    };
  }) {
    return this.options.aws.build(input);
  }
}

/** The catalog version a rated row is stamped with, the App's own spelling. */
export function currentRegistryRateVersion(): string {
  const date = (llmModels.updatedAt ?? "").slice(0, 10);
  return date ? `registry@${date}` : "registry@unversioned";
}

/** Ingestion-pull run outcomes and durations, pushed over OTLP. */
export class OtelGovernanceIngestionPullMetrics implements GovernanceIngestionPullMetricsPort {
  static create(): OtelGovernanceIngestionPullMetrics {
    return new OtelGovernanceIngestionPullMetrics(
      counter({
        name: INGESTION_PULL_TOTAL_METRIC_NAME,
        description: "Ingestion pull runs by outcome",
      }),
      histogram({
        name: INGESTION_PULL_DURATION_METRIC_NAME,
        description: "Duration of one ingestion pull run",
      }),
    );
  }

  private constructor(
    private readonly runs: CounterHandle,
    private readonly duration: HistogramHandle,
  ) {}

  count(outcome: "completed" | "failed_retryable" | "failed_final"): void {
    this.runs.inc({ outcome }, 1);
  }

  observeDuration(durationMs: number): void {
    this.duration.observe(durationMs);
  }
}

/**
 * When a configured pull next fires: the cron, evaluated in UTC.
 *
 * UTC rather than the organization's zone, and that is the schedule's own
 * decision rather than this adapter's — an ingestion pull is a machine
 * cadence, not a person's calendar, and moving it under DST would change how
 * much usage each window covers twice a year.
 */
export class UtcGovernanceIngestionPullSchedule implements GovernanceIngestionPullSchedulePort {
  static create(): UtcGovernanceIngestionPullSchedule {
    return new UtcGovernanceIngestionPullSchedule();
  }

  private constructor() {}

  nextRunAt(input: { cron: string; after: number }): number {
    return computeNextRunAt({
      cron: input.cron,
      timezone: "UTC",
      after: new Date(input.after),
    }).getTime();
  }
}
