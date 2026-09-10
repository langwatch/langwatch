import { analyticsFilterValueSchema } from "@langwatch/analytics-contract";
import { generateClickHouseFilterConditions } from "@langwatch/analytics-server";
import type { ClickHouseClient } from "@clickhouse/client";
import type { FoldProjectionStore } from "@langwatch/eventing";
import type { TraceCanonicalisationService, TraceSummaryData } from "@langwatch/trace-contract";
import type { TraceInfrastructure, TraceProcessingCommands } from "@langwatch/trace-server";
import { z } from "zod";
import { createWorkerTraceBlobRead } from "./worker-trace-blob-read.composition.ts";
import type { WorkerObjectStorage } from "./worker-object-storage.composition.ts";

const legacyFiltersSchema = z.record(z.string(), analyticsFilterValueSchema);

/** Storage/config for the canonical Trace declaration in the worker's shared feature runtime. */
export function createWorkerTraceInfrastructure(options: {
  resolveClickHouseClient: (tenantId: string) => Promise<ClickHouseClient>;
  defaultRetentionDays: number;
  canonicalisation: TraceCanonicalisationService;
  summaryStore: FoldProjectionStore<TraceSummaryData>;
  commands: TraceProcessingCommands;
  broadcast: TraceInfrastructure["trace"]["broadcast"];
  storage: WorkerObjectStorage;
  fallbackVisibilityDays: number;
  processName: string;
}): TraceInfrastructure {
  return {
    trace: {
      resolveClickHouseClient: options.resolveClickHouseClient,
      defaultRetentionDays: options.defaultRetentionDays,
      canonicalisation: options.canonicalisation,
      summaryStore: options.summaryStore,
      commands: options.commands,
      broadcast: options.broadcast,
      fallbackVisibilityDays: options.fallbackVisibilityDays,
      processName: options.processName,
      blobStore: createWorkerTraceBlobRead(options),
      filterConditions: (filters, window) =>
        generateClickHouseFilterConditions(legacyFiltersSchema.parse(filters), window),
    },
  };
}
