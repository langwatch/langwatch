import { createLogger } from "@langwatch/observability";
import type {
  RecordEvaluationInput,
  TriggerLatestEvaluation,
  TriggerLatestEvaluationRepository,
} from "./repositories/trigger-latest-evaluation.repository";

const logger = createLogger("langwatch:automations:latest-evaluation");

/**
 * The alert evaluator's observation record: what the last check saw and
 * decided, so "why is this alert not firing?" has an answer in the product.
 *
 * The write is best-effort by design. An alert that fired but failed to record
 * that it fired is a much smaller problem than an alert that did not fire
 * because recording failed — so `record` swallows its own failure and logs it,
 * and the evaluation path continues either way.
 */
export class TriggerLatestEvaluationService {
  constructor(private readonly repo: TriggerLatestEvaluationRepository) {}

  /** Replace the trigger's snapshot with this evaluation. Never throws. */
  async record(input: RecordEvaluationInput): Promise<void> {
    try {
      await this.repo.upsert(input);
    } catch (error) {
      logger.warn(
        {
          projectId: input.projectId,
          triggerId: input.triggerId,
          verdict: input.verdict,
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to record the alert's latest evaluation — the evaluation itself is unaffected",
      );
    }
  }

  /** The trigger's latest evaluation, or null when it has never been
   *  evaluated. */
  async getByTriggerId(params: {
    projectId: string;
    triggerId: string;
  }): Promise<TriggerLatestEvaluation | null> {
    return this.repo.findByTriggerId(params);
  }
}
