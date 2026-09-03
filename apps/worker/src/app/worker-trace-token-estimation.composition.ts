import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import {
  TraceSpanTokenEstimationAdapter,
  type TraceSpanTokenEstimationPort,
  type TraceTokenCounterPort,
} from "@langwatch/trace-server";
import { WorkerTiktokenCounterAdapter } from "../platform/infrastructure/worker-token-counter.adapter";
import type { WorkerTraceTokenizerConfig } from "../platform/config/worker.config";

/**
 * The token counts this process would stamp on a span that arrived without any.
 *
 * STAGED, NOT MOUNTED. Trace has not converted — the application still owns
 * `RecordSpanCommand`'s adapters and still estimates every LLM span it ingests
 * — so nothing in this process counts a token yet. What has to be true today is
 * that this composition root CAN build the path from what it already holds: the
 * two tokenizer variables it now reads and the feature-flag service. That is
 * the whole dependency list.
 *
 *     TraceSpanTokenEstimationPort         (trace-server declares it)
 *       └─ OtlpSpanTokenEstimationService  (trace-server owns it)
 *            ├─ FeatureFlagService         the two kill switches
 *            └─ TraceTokenCounterPort      the encoding tables
 *                 └─ WorkerTiktokenCounterAdapter   tiktoken, local BPE first
 *
 * The two kill switches are the reason the feature-flag service is a hard
 * dependency rather than an option: `token-estimation-killswitch` and
 * `token-estimation-project-killswitch` are how an operator stops estimation
 * without a deploy, and a process that could not read them would keep
 * estimating after the switch was thrown.
 */
export function createWorkerTraceTokenEstimation(options: {
  config: WorkerTraceTokenizerConfig;
  featureFlags: FeatureFlagService;
  tokenizer?: TraceTokenCounterPort;
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
    readonly tokenizer: TraceTokenCounterPort,
    private readonly estimation: TraceSpanTokenEstimationAdapter,
  ) {}

  /** The narrow port `RecordSpanCommand` names, over this graph. */
  spanTokenEstimationPort(): TraceSpanTokenEstimationPort {
    return this.estimation;
  }
}
