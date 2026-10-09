import type { InstantEvalRunRow } from "./instant-eval-run.repository";

/** Reporting impairment, independent of the run's execution outcome.
 * Never cleared by a flag change or a later projection: neither proves repair.
 */
export interface InstantEvalProcessingBlock {
  readonly code: "instant_eval_processing_disabled";
  readonly observedAtMs: number;
  readonly stages: readonly {
    readonly componentType: "command" | "projection";
    readonly componentName: string;
  }[];
}

/** Enriched read view; receipt metadata is never persisted on the run row. */
export type InstantEvalRunView = InstantEvalRunRow & {
  readonly processingBlock?: InstantEvalProcessingBlock;
};
