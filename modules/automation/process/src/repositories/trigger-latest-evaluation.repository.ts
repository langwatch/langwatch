import type { TriggerLatestEvaluation } from "@langwatch/automation-contract";

/**
 * Each alert's latest-evaluation snapshot: one row per trigger, replaced on
 * every check, so the table is bounded by the number of alerts. A snapshot,
 * not a ledger: the fire history is {@link TriggerFireHistoryRepository}.
 */
export abstract class TriggerLatestEvaluationRepository {
  /** Replace the trigger's snapshot; answers 0 when another project owns the row. */
  abstract upsert(input: TriggerLatestEvaluation): Promise<number>;
  /** The trigger's latest evaluation: zero rows when it has never been evaluated. */
  abstract findByTriggerId(input: {
    projectId: string;
    triggerId: string;
  }): Promise<TriggerLatestEvaluation[]>;
}
