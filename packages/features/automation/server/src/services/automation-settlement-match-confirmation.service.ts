import type { TriggerSummary } from "@langwatch/automation-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import type {
  AutomationSettlementEvaluationReaderPort,
  AutomationSettlementTraceReaderPort,
} from "../ports/automation-settlement-read.port";
import {
  AutomationSettlementFilterEvaluatorPort,
  AutomationSettlementMatchConfirmationPort,
} from "../ports/automation-settlement.port";

const EVENT_FILTER_FIELDS = new Set([
  "events.event_type",
  "events.metrics.key",
  "events.metrics.value",
  "events.event_details.key",
]);

function hasEventFilters(filters: Record<string, unknown>): boolean {
  return Object.keys(filters).some((field) => EVENT_FILTER_FIELDS.has(field));
}

function splitFilters(filters: Record<string, unknown>): {
  trace: Record<string, unknown>;
  evaluation: Record<string, unknown>;
} {
  const trace: Record<string, unknown> = {};
  const evaluation: Record<string, unknown> = {};

  for (const [field, value] of Object.entries(filters)) {
    if (field.startsWith("evaluations.")) {
      evaluation[field] = value;
    } else {
      trace[field] = value;
    }
  }

  return { trace, evaluation };
}

/** Confirms a recorded match against its settled trace state before delivery.
 * The service owns conditional reads and fail-closed sequencing; the injected
 * trace evaluator owns only the host's query/filter implementation. */
export class AutomationSettlementMatchConfirmationService extends AutomationSettlementMatchConfirmationPort {
  private constructor(
    private readonly evaluations: AutomationSettlementEvaluationReaderPort,
    private readonly traces: AutomationSettlementTraceReaderPort,
    private readonly filterEvaluator: AutomationSettlementFilterEvaluatorPort,
  ) {
    super();
  }

  static create(input: {
    evaluations: AutomationSettlementEvaluationReaderPort;
    traces: AutomationSettlementTraceReaderPort;
    filterEvaluator: AutomationSettlementFilterEvaluatorPort;
  }): AutomationSettlementMatchConfirmationService {
    return new AutomationSettlementMatchConfirmationService(
      input.evaluations,
      input.traces,
      input.filterEvaluator,
    );
  }

  async confirms(input: {
    trigger: TriggerSummary;
    projectId: string;
    traceId: string;
    foldState: TraceSummaryData;
  }): Promise<boolean> {
    if (input.trigger.filterQuery !== null) {
      return this.confirmFilterQuery(input);
    }

    return this.confirmLegacyFilters(input);
  }

  private async confirmFilterQuery(input: {
    trigger: TriggerSummary;
    projectId: string;
    traceId: string;
    foldState: TraceSummaryData;
  }): Promise<boolean> {
    const query = input.trigger.filterQuery;
    if (query === null) {
      return false;
    }

    const needs = this.traces.classifyQuery({ query });
    const evaluations = needs.evaluations
      ? await this.evaluations.findRunsByTraceId({
          tenantId: input.projectId,
          traceId: input.traceId,
        })
      : null;
    const events = needs.events ? await this.deriveEvents(input) : null;

    return this.filterEvaluator.matchesFilterQuery({
      query,
      foldState: input.foldState,
      evaluations,
      events,
    });
  }

  private async confirmLegacyFilters(input: {
    trigger: TriggerSummary;
    projectId: string;
    traceId: string;
    foldState: TraceSummaryData;
  }): Promise<boolean> {
    const { trace, evaluation } = splitFilters(input.trigger.filters);
    const events = hasEventFilters(trace) ? await this.deriveEvents(input) : null;

    if (
      Object.keys(trace).length > 0 &&
      !this.filterEvaluator.matchesTraceFilters({
        filters: trace,
        foldState: input.foldState,
        events,
      })
    ) {
      return false;
    }

    if (Object.keys(evaluation).length === 0) {
      return true;
    }

    const evaluations = await this.evaluations.findRunsByTraceId({
      tenantId: input.projectId,
      traceId: input.traceId,
    });

    return this.filterEvaluator.matchesEvaluationFilters({
      filters: evaluation,
      evaluations,
    });
  }

  private deriveEvents(input: { projectId: string; traceId: string; foldState: TraceSummaryData }) {
    return this.traces.deriveEvents({
      projectId: input.projectId,
      traceId: input.traceId,
      occurredAtMs: input.foldState.occurredAt,
      foldVersion: input.foldState.spanCount,
    });
  }
}
