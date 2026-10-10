import type { TriggerLatestEvaluation } from "@langwatch/automation-contract";

import type { TriggerLatestEvaluationRepository } from "../repositories/trigger-latest-evaluation.repository.ts";
import type { AutomationLogger } from "./automation.service.ts";

/**
 * What an alert's last check saw and decided, so "why is this alert not firing?"
 * has an answer in the product. Recording is best-effort: it logs its own
 * failure and never throws, so a recording problem cannot suppress an alert.
 */
export class TriggerLatestEvaluationService {
  private constructor(
    private readonly repository: TriggerLatestEvaluationRepository,
    private readonly logger: AutomationLogger,
  ) {}

  static create(input: {
    repository: TriggerLatestEvaluationRepository;
    logger: AutomationLogger;
  }): TriggerLatestEvaluationService {
    return new TriggerLatestEvaluationService(input.repository, input.logger);
  }

  /** Replace the trigger's snapshot with this evaluation. Never throws. */
  async record(input: TriggerLatestEvaluation): Promise<void> {
    const fields = {
      projectId: input.projectId,
      triggerId: input.triggerId,
      verdict: input.verdict,
    };
    try {
      const written = await this.repository.upsert(input);
      if (written === 0) {
        this.logger.warn(
          fields,
          "the latest-evaluation write affected no rows — an existing row for this trigger belongs to another project",
        );
      }
    } catch (error) {
      this.logger.warn(
        {
          ...fields,
          error:
            error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
        },
        "failed to record the alert's latest evaluation — the evaluation itself is unaffected",
      );
    }
  }

  /** The trigger's latest evaluation: zero rows when it has never been evaluated. */
  findByTriggerId(input: {
    projectId: string;
    triggerId: string;
  }): Promise<TriggerLatestEvaluation[]> {
    return this.repository.findByTriggerId(input);
  }
}
