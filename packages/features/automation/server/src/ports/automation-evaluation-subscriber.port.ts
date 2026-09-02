import type { TriggerMatchRecordedEventData } from "@langwatch/automation-contract";
import type { TraceQueryClassification, TraceSummaryData } from "@langwatch/trace-contract";

export abstract class AutomationEvaluationTriggerFilterPort {
  abstract readsEvaluations(input: {
    filters: Record<string, unknown>;
    filterQuery: string | null;
  }): boolean;
}

export abstract class AutomationTriggerMatchRecorderPort {
  abstract send(
    input: TriggerMatchRecordedEventData & {
      tenantId: string;
      occurredAt: number;
    },
  ): Promise<void>;
}

/**
 * The ONE trace read the evaluation alert subscriber makes.
 *
 * A trace summary, to address the alert with the trace it is about. Narrower
 * than `TraceService`, which that read used to be named through: the full
 * capability carries the list, span, media and protection paths a background
 * subscriber never touches, and `TraceService` satisfies this port
 * structurally so an application composition is unchanged.
 */
export abstract class AutomationEvaluationTraceSummaryPort {
  abstract tryGetSummary(input: {
    projectId: string;
    traceId: string;
  }): Promise<TraceSummaryData | null>;
}

/**
 * Whether a saved filter query reads evaluations at all.
 *
 * Synchronous because the published service's is: classification is a parse
 * of the customer's own query text, not a read. Narrowed off `TraceService`
 * for the same reason the summary read is, and satisfied by it structurally.
 */
export abstract class AutomationEvaluationQueryClassificationPort {
  abstract classifyQuery(input: { query: string }): TraceQueryClassification;
}
