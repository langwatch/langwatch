import type { AutomationEvaluationQueryClassification } from "../app/automation.infrastructure.ts";
import { AutomationEvaluationTriggerFilter } from "../app/automation.infrastructure.ts";

/**
 * Automation-owned answer to whether a trigger needs an evaluation-terminal
 * wake-up. The subscriber and trace dispatcher use the same decision, so an
 * app filter implementation cannot drift from the feature's trigger contract.
 */
export class AutomationEvaluationTriggerFilterService implements AutomationEvaluationTriggerFilter {
  static create(
    traces: AutomationEvaluationQueryClassification,
  ): AutomationEvaluationTriggerFilterService {
    return new AutomationEvaluationTriggerFilterService(traces);
  }

  private constructor(private readonly traces: AutomationEvaluationQueryClassification) {
  }

  readsEvaluations(input: {
    filters: Record<string, unknown>;
    filterQuery: string | null;
  }): boolean {
    if (input.filterQuery === null) {
      return Object.keys(input.filters).some((field) => field.startsWith("evaluations."));
    }

    return this.traces.classifyQuery({ query: input.filterQuery }).evaluations;
  }
}
