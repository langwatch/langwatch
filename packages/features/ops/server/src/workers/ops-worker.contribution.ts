import { createLogger } from "@langwatch/observability";
import type { OpsWorkerHandle, UsageStatsWorkerConfig } from "../ports/ops-worker.port";
import type {
  UsageStatsCollector,
  UsageStatsErrorReporter,
  UsageStatsOrganizationRepository,
  UsageStatsTelemetryClient,
} from "../ports/usage-stats-worker.ports";

const anomalyLogger = createLogger("langwatch:observability:anomalyWorker");
const usageStatsLogger = createLogger("langwatch:workers:usageStatsWorker");

const ANOMALY_TICK_INTERVAL_MS = 60_000;
const USAGE_STATS_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface AnomalyTickResult {
  surfaced: number;
  cleared: number;
}

/** The anomaly capability scheduled by this worker contribution. */
export interface AnomalyTickPort {
  tick(): Promise<AnomalyTickResult>;
}

export interface AnomalyWorkerContributionOptions {
  detector: AnomalyTickPort;
}

/**
 * Process-owned scheduling contribution for the tenant rate anomaly service.
 * Construction has no effects; the worker process explicitly calls start.
 */
export class AnomalyWorkerContribution {
  private constructor(private readonly detector: AnomalyTickPort) {}

  static create(options: AnomalyWorkerContributionOptions): AnomalyWorkerContribution {
    return new AnomalyWorkerContribution(options.detector);
  }

  start(): OpsWorkerHandle {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const tick = async () => {
      if (stopped) {
        return;
      }

      try {
        const result = await this.detector.tick();
        if (result.surfaced > 0 || result.cleared > 0) {
          anomalyLogger.info(result, "anomaly tick");
        }
      } catch (err) {
        anomalyLogger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "anomaly detector tick failed (will retry on next interval)",
        );
      }
      if (!stopped) {
        timer = setTimeout(() => void tick(), ANOMALY_TICK_INTERVAL_MS);
      }
    };

    timer = setTimeout(() => void tick(), 5_000);

    anomalyLogger.info("anomaly worker started");

    return {
      async stop() {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
        }

        anomalyLogger.info("anomaly worker stopped");
      },
    };
  }
}

export interface UsageStatsWorkerContributionOptions {
  config: UsageStatsWorkerConfig;
  organizations: UsageStatsOrganizationRepository;
  usageStats: UsageStatsCollector;
  telemetry: UsageStatsTelemetryClient;
  errors: UsageStatsErrorReporter;
}

/**
 * Process-owned scheduling contribution for daily self-hosted telemetry.
 * The worker is disabled by typed composition config, never environment reads.
 */
export class UsageStatsWorkerContribution {
  private constructor(private readonly options: UsageStatsWorkerContributionOptions) {}

  static create(
    options: UsageStatsWorkerContributionOptions,
  ): UsageStatsWorkerContribution {
    return new UsageStatsWorkerContribution(options);
  }

  start(): OpsWorkerHandle | undefined {
    if (this.options.config.disabled) {
      usageStatsLogger.info("usage stats disabled, skipping usage stats worker");
      return void 0;
    }

    let stopped = false;
    let timer: NodeJS.Timeout | undefined;

    const tick = async () => {
      if (stopped) {
        return;
      }

      try {
        await this.sendForAllOrganizations();
      } catch (error) {
        usageStatsLogger.warn(
          { error },
          "usage stats tick failed (will retry on next interval)",
        );
      }
      if (!stopped) {
        timer = setTimeout(() => void tick(), USAGE_STATS_INTERVAL_MS);
      }
    };

    const nextNoonUtc = this.options.config.now();
    nextNoonUtc.setUTCHours(12, 0, 0, 0);
    let firstTickDelayMs = nextNoonUtc.getTime() - this.options.config.now().getTime();
    if (firstTickDelayMs <= 0) {
      firstTickDelayMs += USAGE_STATS_INTERVAL_MS;
    }

    timer = setTimeout(() => void tick(), firstTickDelayMs);

    usageStatsLogger.info({ firstTickDelayMs }, "usage stats worker started");

    return {
      stop() {
        stopped = true;
        if (timer) {
          clearTimeout(timer);
        }

        usageStatsLogger.info("usage stats worker stopped");
      },
    };
  }

  private async sendForAllOrganizations(): Promise<void> {
    const organizations = await this.options.organizations.listForUsageStats();

    if (organizations.length === 0) {
      usageStatsLogger.debug("no organizations found, skipping usage stats");
      return;
    }

    for (const organization of organizations) {
      const instanceId = `${organization.name}__${organization.id}`;
      try {
        const stats = await this.options.usageStats.collect({
          organizationId: organization.id,
        });
        await this.options.telemetry.send({
          event: "daily_usage_stats",
          install_method: this.options.config.installMethod,
          hostname: this.options.config.hostname,
          environment: this.options.config.environment,
          instance_id: instanceId,
          ...stats,
        });
        usageStatsLogger.info({ instanceId }, "usage stats sent");
      } catch (error) {
        usageStatsLogger.error({ instanceId, error }, "failed to send usage stats");
        await this.options.errors.capture({ instanceId, error });
      }
    }
  }
}
