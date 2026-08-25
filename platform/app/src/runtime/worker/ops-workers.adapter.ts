import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import type { Anomaly } from "@langwatch/ops-contract";
import {
  AnomalyHardTierAlertPort,
  OpsWorkerAdapter,
  UsageStatsClickHouseClient,
  UsageStatsClickHouseClientResolver,
  UsageStatsErrorReporter,
  UsageStatsTelemetryClient,
  type AnomalyFeatureFlagConfig,
  type AnomalyFeatureFlagsPort,
  type OpsWorkerHandle,
  type UsageStatsClickHouseQuery,
  type UsageStatsClickHouseQueryResult,
  type UsageStatsWorkerConfig,
} from "@langwatch/ops-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { BUILDER_CHART_KIND } from "~/server/analytics/chartKinds";
import { captureException, toError, withScope } from "~/utils/posthogErrorCapture";
import type { Cluster, Redis } from "ioredis";
import { z } from "zod";

const anomalyLogger = createLogger("langwatch:observability:anomalyWorker");

const environmentBooleanSchema = z
  .union([
    z.boolean(),
    z.literal("true"),
    z.literal("false"),
    z.literal("1"),
    z.literal("0"),
  ])
  .transform((value) => value === true || value === "true" || value === "1");

const opsWorkerEnvironmentSchema = z
  .object({
    DISABLE_USAGE_STATS: environmentBooleanSchema.optional().default(false),
    IS_SAAS: environmentBooleanSchema.optional().default(false),
    INSTALL_METHOD: z.string().trim().min(1).default("self-hosted"),
    BASE_HOST: z.string().trim().min(1).optional(),
    NODE_ENV: z.string().trim().min(1).optional(),
  })
  .passthrough();

export function resolveOpsWorkerConfig(
  source: Readonly<Record<string, unknown>>,
): UsageStatsWorkerConfig {
  const parsed = opsWorkerEnvironmentSchema.parse(source);

  return {
    disabled: parsed.DISABLE_USAGE_STATS || parsed.IS_SAAS,
    installMethod: parsed.INSTALL_METHOD,
    hostname: parsed.BASE_HOST,
    environment: parsed.NODE_ENV,
    now: () => new Date(),
  };
}

class AppUsageStatsClickHouseClient extends UsageStatsClickHouseClient {
  private constructor(private readonly client: ClickHouseClient) {
    super();
  }

  static create(client: ClickHouseClient): AppUsageStatsClickHouseClient {
    return new AppUsageStatsClickHouseClient(client);
  }

  async query(
    input: UsageStatsClickHouseQuery,
  ): Promise<UsageStatsClickHouseQueryResult> {
    const result = await this.client.query(input);

    return {
      json: () => result.json(),
    };
  }
}

class AppUsageStatsClickHouseClientResolver extends UsageStatsClickHouseClientResolver {
  private constructor(
    private readonly resolveClient: (
      organizationId: string,
    ) => Promise<ClickHouseClient | null>,
  ) {
    super();
  }

  static create(
    resolveClient: (organizationId: string) => Promise<ClickHouseClient | null>,
  ): AppUsageStatsClickHouseClientResolver {
    return new AppUsageStatsClickHouseClientResolver(resolveClient);
  }

  async tryResolve(organizationId: string): Promise<UsageStatsClickHouseClient | null> {
    const client = await this.resolveClient(organizationId);

    return client ? AppUsageStatsClickHouseClient.create(client) : null;
  }
}

class LangWatchUsageStatsTelemetryAdapter extends UsageStatsTelemetryClient {
  private constructor(private readonly http: typeof fetch) {
    super();
  }

  static create(http: typeof fetch): LangWatchUsageStatsTelemetryAdapter {
    return new LangWatchUsageStatsTelemetryAdapter(http);
  }

  async send(report: Record<string, unknown>): Promise<void> {
    await this.http("https://app.langwatch.ai/api/track_usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
  }
}

class PostHogUsageStatsErrorReporterAdapter extends UsageStatsErrorReporter {
  private constructor() {
    super();
  }

  static create(): PostHogUsageStatsErrorReporterAdapter {
    return new PostHogUsageStatsErrorReporterAdapter();
  }

  async capture(input: { instanceId: string; error: unknown }): Promise<void> {
    await withScope(async (scope) => {
      scope.setTag?.("worker", "usageStats");
      scope.setExtra?.("instanceId", input.instanceId);
      captureException(toError(input.error));
    });
  }
}

class LoggedHardTierAnomalyAlertAdapter extends AnomalyHardTierAlertPort {
  private constructor() {
    super();
  }

  static create(): LoggedHardTierAnomalyAlertAdapter {
    return new LoggedHardTierAnomalyAlertAdapter();
  }

  async notify(anomaly: Anomaly): Promise<void> {
    anomalyLogger.error(
      {
        tenantId: anomaly.tenantId,
        currentRate: anomaly.currentRate,
        baseline: anomaly.baseline,
        reason: anomaly.reason,
      },
      "HARD-TIER anomaly: manual investigation required (auto-pause not yet wired)",
    );
  }
}

export interface AppOpsWorkerAdapterOptions {
  anomaly: {
    redis: Redis | Cluster | undefined;
    featureFlags: AnomalyFeatureFlagsPort;
    featureFlagConfig: AnomalyFeatureFlagConfig;
  };
  usageStats: {
    database: PrismaClient;
    resolveClickHouseClient: (organizationId: string) => Promise<ClickHouseClient | null>;
    config: UsageStatsWorkerConfig;
    http: typeof fetch;
  };
}

/** Worker composition only; importing it starts no resources. */
export class AppOpsWorkerAdapter {
  private constructor(private readonly workers: OpsWorkerAdapter) {}

  static create(options: AppOpsWorkerAdapterOptions): AppOpsWorkerAdapter {
    const workers = OpsWorkerAdapter.create({
      anomaly: {
        ...options.anomaly,
        hardTierAlerts: LoggedHardTierAnomalyAlertAdapter.create(),
      },
      usageStats: {
        database: options.usageStats.database,
        clickhouse: AppUsageStatsClickHouseClientResolver.create(
          options.usageStats.resolveClickHouseClient,
        ),
        config: options.usageStats.config,
        telemetry: LangWatchUsageStatsTelemetryAdapter.create(options.usageStats.http),
        errors: PostHogUsageStatsErrorReporterAdapter.create(),
        builderChartKind: BUILDER_CHART_KIND,
      },
    });

    return new AppOpsWorkerAdapter(workers);
  }

  startAnomalyWorker(): OpsWorkerHandle | undefined {
    return this.workers.startAnomalyWorker();
  }

  startUsageStatsWorker(): OpsWorkerHandle | undefined {
    return this.workers.startUsageStatsWorker();
  }
}
