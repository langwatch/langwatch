import type { PrismaClient } from "~/generated/prisma/client";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { AnnotationService } from "@langwatch/annotation-contract";
import {
  AutomationSettlementDispatchService,
  AutomationSettlementFilterEvaluatorPort,
  AutomationSettlementMatchConfirmationService,
  AutomationSettlementObservabilityPort,
  SlackProviderAdapter,
  WebhookProviderAdapter,
  type AutomationEmailCapService,
} from "@langwatch/automation-server";
import type { AutomationService } from "@langwatch/automation-contract";
import type { EvaluationRunData, EvaluationService } from "@langwatch/evaluation-contract";
import type {
  DerivedTraceEvent,
  TraceCanonicalisationService,
  TraceService,
} from "@langwatch/trace-contract";
import { evaluateQueryInMemory } from "@langwatch/trace-server";
import type { ProjectService } from "@langwatch/project-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { AppAutomationPersistActionAdapter } from "./automation-adapters/automation-persist-action.adapter";
import {
  buildPreconditionTraceDataFromFoldState,
  matchesEvaluationFilters,
  matchesTriggerFilters,
} from "~/server/filters/triggerFilter.matcher";
import { sanitizeTriggerFilters, triggerFiltersPermissiveSchema } from "~/server/filters/types";
import { createAutomationNotificationDeliveryPort } from "./automation-graph-ports";
import { AppAutomationClock } from "./automation";
import { decrypt, encrypt } from "~/utils/encryption";
import { incrementAutomationOverflowFlushTotal } from "~/server/metrics";
import { captureException } from "~/utils/posthogErrorCapture";

/**
 * ADR-052 composition root for automation dispatch: builds the deps the
 * settlement intent handlers and the graph-alert paths need. This is the
 * legacy `buildOutboxRuntime` wiring minus queue transport — the process
 * outbox owns retry now.
 */
export interface AutomationDispatchPorts {
  settlement: AutomationSettlementDispatchService;
}

class AppSettlementFilterEvaluator extends AutomationSettlementFilterEvaluatorPort {
  matchesFilterQuery(input: {
    query: string;
    foldState: TraceSummaryData;
    evaluations: EvaluationRunData[] | null;
    events: DerivedTraceEvent[] | null;
  }): boolean {
    return evaluateQueryInMemory(input.query, {
      summary: input.foldState,
      evaluations: input.evaluations,
      events: input.events,
      spans: null,
    });
  }

  matchesTraceFilters(input: {
    filters: Record<string, unknown>;
    foldState: TraceSummaryData;
    events: DerivedTraceEvent[] | null;
  }): boolean {
    const filters = parseKnownFilters(input.filters);
    if (!filters) {
      return false;
    }

    return matchesTriggerFilters(
      buildPreconditionTraceDataFromFoldState(input.foldState, input.events),
      filters,
    );
  }

  matchesEvaluationFilters(input: {
    filters: Record<string, unknown>;
    evaluations: EvaluationRunData[];
  }): boolean {
    const filters = parseKnownFilters(input.filters);
    return filters ? matchesEvaluationFilters(input.evaluations, filters) : false;
  }
}

function parseKnownFilters(filters: Record<string, unknown>) {
  const parsed = triggerFiltersPermissiveSchema.safeParse(filters);
  if (!parsed.success) {
    return null;
  }

  const result = sanitizeTriggerFilters(parsed.data);
  return result.unknownFields.length === 0 ? result.sanitized : null;
}

class AppSettlementObservability extends AutomationSettlementObservabilityPort {
  recordOverflow(flushed: number): void {
    incrementAutomationOverflowFlushTotal(flushed);
  }

  capture(error: Error, extra: Record<string, unknown>): void {
    captureException(error, { extra });
  }
}

export function buildAutomationDispatchPorts({
  prisma,
  automation,
  emailCaps,
  projects,
  evaluations,
  traces,
  dataset,
  annotations,
  baseHost,
  emailHourlyCap,
  tenantDailyCap,
}: {
  prisma: PrismaClient;
  automation: AutomationService;
  emailCaps: AutomationEmailCapService;
  projects: ProjectService;
  evaluations: EvaluationService;
  traces: {
    canonicalisation: TraceCanonicalisationService;
    tree: TraceService;
  };
  dataset: DatasetService;
  annotations: AnnotationService;
  /** Semantic process configuration resolved by the executable boot. */
  baseHost: string;
  emailHourlyCap: number;
  tenantDailyCap: number;
}): AutomationDispatchPorts {
  const settlement = AutomationSettlementDispatchService.create({
    automation,
    projects,
    baseHost,
    traces: traces.tree,
    confirmation: AutomationSettlementMatchConfirmationService.create({
      evaluations,
      traces: traces.tree,
      filterEvaluator: new AppSettlementFilterEvaluator(),
    }),
    persistActions: AppAutomationPersistActionAdapter.create({
      database: prisma,
      automation,
      projects,
      traces: traces.tree,
      annotations,
      traceCanonicalisation: traces.canonicalisation,
      dataset,
    }),
    delivery: createAutomationNotificationDeliveryPort(),
    emailCaps,
    slack: SlackProviderAdapter.create({ encrypt, decrypt }),
    webhooks: WebhookProviderAdapter.create({ encrypt, decrypt }),
    clock: new AppAutomationClock(),
    observability: new AppSettlementObservability(),
    emailHourlyCap,
    tenantDailyCap,
  });

  return { settlement };
}
