import type { TriggerSummary } from "@langwatch/automation-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";

/** Dispatch-time recheck against the settled trace. This has one
 * compatibility implementation while the trace filter evaluator finishes its
 * own extraction; it cannot choose delivery, claims, caps, or retries. */
export abstract class AutomationSettlementMatchConfirmation {
  abstract confirms(input: {
    trigger: TriggerSummary;
    projectId: string;
    traceId: string;
    foldState: TraceSummaryData;
  }): Promise<boolean>;
}
