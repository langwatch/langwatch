import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import {
  TraceSpanTokenEstimationAdapter,
  type TraceSpanTokenEstimation,
  type TraceTokenCounter,
} from "@langwatch/trace-server";
import { WorkerTiktokenCounterAdapter } from "../platform/infrastructure/worker-token-counter.adapter.ts";
import type { WorkerTraceTokenizerConfig } from "../platform/config/worker.config.ts";

/**
 * Staged but not mounted; builds the token-estimation from tokenizer and
 * feature flags.
 */
export function createWorkerTraceTokenEstimation(options: {
  config: WorkerTraceTokenizerConfig;
  featureFlags: FeatureFlagApi;
  tokenizer?: TraceTokenCounter;
}): WorkerTraceTokenEstimation {
  const tokenizer = options.tokenizer ?? WorkerTiktokenCounterAdapter.create(options.config);
  return new WorkerTraceTokenEstimation(
    tokenizer,
    TraceSpanTokenEstimationAdapter.create({
      tokenizer,
      featureFlags: options.featureFlags,
    }),
  );
}

/** One process-owned estimation graph, and the counter it has to give back. */
export class WorkerTraceTokenEstimation {
  constructor(
    readonly tokenizer: TraceTokenCounter,
    private readonly estimation: TraceSpanTokenEstimationAdapter,
  ) {}

  /** The narrow port `EventingRecordSpanAdapter` names, over this graph. */
  spanTokenEstimationPort(): TraceSpanTokenEstimation {
    return this.estimation;
  }
}
