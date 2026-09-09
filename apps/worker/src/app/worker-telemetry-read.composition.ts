import type { ClickHouseClient } from "@clickhouse/client";
import {
  OtelPiiAnalysisMetricsAdapter,
  PrismaDataPrivacyDirectoryRepository,
  type DataPrivacyDirectoryDatabase,
  type DataPrivacyInfrastructure,
} from "@langwatch/data-privacy-server";
import type { LogServerConfig } from "@langwatch/log-contract";
import type { LogInfrastructure } from "@langwatch/log-server";
import type { ResourceScope } from "@langwatch/runtime-composition";
import type { WorkerTracePrivacyConfig } from "../platform/config/worker.config.ts";
import { WorkerPiiAnalysisAdapter } from "../platform/infrastructure/worker-pii-analysis.adapter.ts";
import { WORKER_PII_REDACTION_MAX_ATTRIBUTE_LENGTH } from "./worker-trace-privacy.composition.ts";
import { z } from "zod";

/** Technical inputs for the canonical Privacy and Log Apps in the shared worker runtime. */
export function createWorkerTelemetryReadInfrastructure(options: {
  database: DataPrivacyDirectoryDatabase;
  config: WorkerTracePrivacyConfig;
  resolveClickHouseClient: (tenantId: string) => Promise<ClickHouseClient>;
  defaultRetentionDays: number;
  resources: ResourceScope;
}): {
  dataPrivacy: DataPrivacyInfrastructure;
  log: LogInfrastructure;
  logConfig: LogServerConfig;
} {
  const transport = WorkerPiiAnalysisAdapter.create({
    config: options.config,
    metrics: OtelPiiAnalysisMetricsAdapter.create(),
  });
  options.resources.own("worker privacy analysis transport", () => transport.close());

  return {
    dataPrivacy: {
      directory: PrismaDataPrivacyDirectoryRepository.create(options.database),
      pii: {
        transport,
        isLangevalsConfigured: Boolean(options.config.presidio.endpoint),
        isProduction: options.config.isProduction,
        nativePolicyEnforced: options.config.nativePolicyEnforced,
        piiRedactionMaxAttributeLength: WORKER_PII_REDACTION_MAX_ATTRIBUTE_LENGTH,
      },
    },
    log: {
      resolveClient: async (tenantId) => {
        const client = await options.resolveClickHouseClient(tenantId);
        return {
          insert: (input) => client.insert({ ...input, values: [...input.values] }),
          query: async (input) => {
            const result = await client.query(input);
            return { json: async () => z.array(z.unknown()).parse(await result.json()) };
          },
        };
      },
    },
    logConfig: {
      processingShards: void 0,
      defaultRetentionDays: options.defaultRetentionDays,
      defaultReadLimit: 100,
    },
  };
}
