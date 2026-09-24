import type { TriggerSummary } from "@langwatch/automation-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { TraceApi, TraceSummaryData } from "@langwatch/trace-contract";

import type {
  AutomationSettlementEvaluationReader,
  AutomationSettlementTraceReader,
} from "../repositories/automation-settlement-read.repository.ts";
import { AutomationSettlementMatchConfirmation } from "./automation-settlement-policy.service.ts";

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

/** The trace owner's in-memory query and legacy-filter matchers. */
export type AutomationSettlementTraceFilters = Pick<
  TraceApi,
  "matchesFilterQuery" | "matchesTraceFilters"
>;

/** The evaluation owner's half of a trigger's legacy filters. */
export type AutomationSettlementEvaluationFilters = Pick<EvaluationApi, "matchesEvaluationFilters">;

/** Confirms a recorded match against its settled trace state before delivery.
 * The service owns conditional reads and fail-closed sequencing; each data
 * owner's Api owns the matching over its own data. */
export class AutomationSettlementMatchConfirmationService extends AutomationSettlementMatchConfirmation {
  private constructor(
    private readonly evaluations: AutomationSettlementEvaluationReader,
    private readonly traces: AutomationSettlementTraceReader,
    private readonly traceFilters: AutomationSettlementTraceFilters,
    private readonly evaluationFilters: AutomationSettlementEvaluationFilters,
  ) {
    super();
  }

  static create(input: {
    evaluations: AutomationSettlementEvaluationReader;
    traces: AutomationSettlementTraceReader;
    traceFilters: AutomationSettlementTraceFilters;
    evaluationFilters: AutomationSettlementEvaluationFilters;
  }): AutomationSettlementMatchConfirmationService {
    return new AutomationSettlementMatchConfirmationService(
      input.evaluations,
      input.traces,
      input.traceFilters,
      input.evaluationFilters,
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

    return this.traceFilters.matchesFilterQuery({
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
      !this.traceFilters.matchesTraceFilters({
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

    return this.evaluationFilters.matchesEvaluationFilters({
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
