import type { MigrationConfig } from "./lib/types.js";

export function loadConfig(overrides?: Partial<MigrationConfig>): MigrationConfig {
  const maxEvents = overrides?.maxEvents ?? intEnv("MAX_EVENTS", 0);
  const maxBatches = overrides?.maxBatches ?? intEnv("MAX_BATCHES", 0);
  return {
    batchSize: overrides?.batchSize ?? intEnv("BATCH_SIZE", 1000),
    dryRun: overrides?.dryRun ?? boolEnv("DRY_RUN", false),
    concurrency: overrides?.concurrency ?? intEnv("CONCURRENCY", 50),
    delayBetweenBatchesMs: overrides?.delayBetweenBatchesMs ?? intEnv("BATCH_DELAY_MS", 0),
    maxEvents: maxEvents > 0 ? maxEvents : undefined,
    maxBatches: maxBatches > 0 ? maxBatches : undefined,
    dryRunOutputFile: overrides?.dryRunOutputFile ?? process.env.DRY_RUN_OUTPUT,
    subBatchSize: overrides?.subBatchSize ?? intEnv("SUB_BATCH_SIZE", 200),
  };
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function boolEnv(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.toLowerCase();
  if (!raw) return fallback;
  return raw === "true" || raw === "1";
}
