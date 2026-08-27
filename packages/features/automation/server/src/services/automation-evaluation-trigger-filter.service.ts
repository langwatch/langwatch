import type { TraceService } from "@langwatch/trace-contract";
import { AutomationEvaluationTriggerFilterPort } from "../ports/automation-evaluation-subscriber.port";

/**
 * Automation-owned answer to whether a trigger needs an evaluation-terminal
 * wake-up. The subscriber and trace dispatcher use the same decision, so an
 * app filter implementation cannot drift from the feature's trigger contract.
 */
export class AutomationEvaluationTriggerFilterService extends AutomationEvaluationTriggerFilterPort {
  static create(traces: TraceService): AutomationEvaluationTriggerFilterService {
    return new AutomationEvaluationTriggerFilterService(traces);
  }

  private constructor(private readonly traces: TraceService) {
    super();
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
