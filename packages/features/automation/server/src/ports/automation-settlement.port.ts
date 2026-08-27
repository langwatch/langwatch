import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import type { DerivedTraceEvent, TraceSummaryData } from "@langwatch/trace-contract";
import type { TriggerSummary } from "@langwatch/automation-contract";
import type { IntentContext } from "@langwatch/eventing";
import type {
  LogOverflowIntent,
  NotifyDigestIntent,
  PersistMatchIntent,
} from "../intents/trigger-settlement.intent";

export abstract class AutomationSettlementExecutorPort {
  abstract notifyDigest(payload: NotifyDigestIntent, context: IntentContext): Promise<void>;
  abstract persistMatch(payload: PersistMatchIntent, context: IntentContext): Promise<void>;
  abstract logOverflow(payload: LogOverflowIntent, context: IntentContext): Promise<void>;
}

/** Dispatch-time recheck against the settled trace. The port has one
 * compatibility implementation while the trace filter evaluator finishes its
 * own extraction; it cannot choose delivery, claims, caps, or retries. */
export abstract class AutomationSettlementMatchConfirmationPort {
  abstract confirms(input: {
    trigger: TriggerSummary;
    projectId: string;
    traceId: string;
    foldState: TraceSummaryData;
  }): Promise<boolean>;
}

/** The host owns the trace-query engine and legacy trace-filter matcher. It
 * receives already-loaded state; deciding which reads are needed and whether a
 * settled match may continue is Automation settlement policy. */
export abstract class AutomationSettlementFilterEvaluatorPort {
  abstract matchesFilterQuery(input: {
    query: string;
    foldState: TraceSummaryData;
    evaluations: EvaluationRunData[] | null;
    events: DerivedTraceEvent[] | null;
  }): boolean;

  abstract matchesTraceFilters(input: {
    filters: Record<string, unknown>;
    foldState: TraceSummaryData;
    events: DerivedTraceEvent[] | null;
  }): boolean;

  abstract matchesEvaluationFilters(input: {
    filters: Record<string, unknown>;
    evaluations: EvaluationRunData[];
  }): boolean;
}

/** The app's monitoring implementation is injected once at process
 * composition; settlement policy never imports app metrics or telemetry. */
export abstract class AutomationSettlementObservabilityPort {
  abstract recordOverflow(flushed: number): void;
  abstract capture(error: Error, extra: Record<string, unknown>): void;
}
