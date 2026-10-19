import type { TraceQueryClassification } from "@langwatch/trace-contract";

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

  private constructor(private readonly traces: AutomationEvaluationQueryClassification) {}

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

export interface AutomationEvaluationTriggerFilter {
  readsEvaluations(input: {
    filters: Record<string, unknown>;
    filterQuery: string | null;
  }): boolean;
}

/**
 * Whether a saved filter query reads evaluations at all. Synchronous,
 * since classification is a parse of the customer's query text, not a
 * read; narrowed off `TraceService` for the same reason the summary read is.
 */
export interface AutomationEvaluationQueryClassification {
  classifyQuery(input: { query: string }): TraceQueryClassification;
}
