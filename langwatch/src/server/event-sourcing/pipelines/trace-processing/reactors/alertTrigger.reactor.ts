import { TriggerAction } from "@prisma/client";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesTriggerFilters,
} from "~/server/filters/triggerFilter.matcher";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import type { DatasetRecordEntry } from "~/server/datasets/types";
import {
  mapTraceToDatasetEntry,
  TRACE_EXPANSIONS,
  type TraceMapping,
} from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";
import { createLogger } from "~/utils/logger/server";
import { captureException } from "~/utils/posthogErrorCapture";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { TraceProcessingEvent } from "../schemas/events";

const logger = createLogger("langwatch:trace-processing:alert-trigger-reactor");

export interface AlertTriggerReactorDeps {
  triggers: TriggerService;
  projects: ProjectService;
  traceById: (projectId: string, traceId: string) => Promise<Trace | undefined>;
  addToAnnotationQueue: (params: {
    traceIds: string[];
    projectId: string;
    annotators: string[];
    userId: string;
  }) => Promise<void>;
  addToDataset: (params: {
    datasetId: string;
    projectId: string;
    datasetRecords: DatasetRecordEntry[];
  }) => Promise<void>;
}

/**
 * Evaluates user-defined trace-based triggers reactively when traces arrive.
 *
 * Fires on every trace event (via traceSummary fold). For each active trigger
 * on the tenant, evaluates filters in-memory against the fold state. If all
 * filters match and the trace hasn't already been sent for this trigger,
 * dispatches the configured action (email, Slack, dataset, annotation queue).
 */
export function createAlertTriggerReactor(
  deps: AlertTriggerReactorDeps,
): ReactorDefinition<TraceProcessingEvent, TraceSummaryData> {
  return {
    name: "alertTrigger",
    options: {
      makeJobId: (payload) =>
        `alert-trigger:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 30_000,
      delay: 30_000,
    },

    async handle(
      event: TraceProcessingEvent,
      context: ReactorContext<TraceSummaryData>,
    ): Promise<void> {
      const { tenantId, aggregateId: traceId, foldState } = context;

      // Guard: skip old traces (resyncing)
      if (event.occurredAt < Date.now() - 60 * 60 * 1000) return;

      // Guard: skip traces blocked by guardrail with no output
      if (foldState.blockedByGuardrail && !foldState.computedOutput) return;

      const attrs = foldState.attributes ?? {};

      // Guard: origin not yet resolved — originGate handles deferred resolution
      if (!attrs["langwatch.origin"]) return;

      const triggers = await deps.triggers.getActiveTraceTriggersForProject(
        tenantId,
      );
      if (triggers.length === 0) return;

      const traceData = buildPreconditionTraceDataFromFoldState(foldState);

      for (const trigger of triggers) {
        try {
          const { traceFilters, hasEvaluationFilters } =
            classifyTriggerFilters(trigger.filters);

          // Skip triggers that require evaluation results (Phase 2)
          if (hasEvaluationFilters) continue;

          // Skip if no trace filters match
          if (
            Object.keys(traceFilters).length > 0 &&
            !matchesTriggerFilters(traceData, traceFilters)
          ) {
            continue;
          }

          // Dedup: check if already sent for this trace
          const alreadySent = await deps.triggers.hasSentForTrace(
            trigger.id,
            traceId,
          );
          if (alreadySent) continue;

          await dispatchAction({
            deps,
            trigger,
            traceId,
            tenantId,
            foldState,
          });
        } catch (error) {
          logger.error(
            {
              tenantId,
              traceId,
              triggerId: trigger.id,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to evaluate trigger",
          );
          captureException(error, {
            extra: {
              tenantId,
              traceId,
              triggerId: trigger.id,
              triggerAction: trigger.action,
            },
          });
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Action dispatch
// ---------------------------------------------------------------------------

interface ActionParams {
  members?: string[] | null;
  slackWebhook?: string | null;
  datasetId?: string;
  datasetMapping?: {
    mapping: Record<string, { source: string; key: string; subkey: string }>;
    expansions: string[];
  };
  annotators?: { id: string; name: string }[];
  createdByUserId?: string;
}

async function dispatchAction({
  deps,
  trigger,
  traceId,
  tenantId,
  foldState,
}: {
  deps: AlertTriggerReactorDeps;
  trigger: TriggerSummary;
  traceId: string;
  tenantId: string;
  foldState: TraceSummaryData;
}): Promise<void> {
  const project = await deps.projects.getById(tenantId);

  if (!project) {
    logger.warn({ tenantId, triggerId: trigger.id }, "Project not found");
    return;
  }

  const triggerData = buildTriggerData(traceId, tenantId, foldState);
  const params = trigger.actionParams as ActionParams;

  switch (trigger.action) {
    case TriggerAction.SEND_EMAIL:
      await sendTriggerEmail({
        triggerEmails: params.members ?? [],
        triggerData: [triggerData],
        triggerName: trigger.name,
        projectSlug: project.slug,
        triggerType: trigger.alertType,
        triggerMessage: trigger.message ?? "",
      });
      break;

    case TriggerAction.SEND_SLACK_MESSAGE:
      await sendSlackWebhook({
        triggerWebhook: params.slackWebhook ?? "",
        triggerData: [triggerData],
        triggerName: trigger.name,
        projectSlug: project.slug,
        triggerType: trigger.alertType,
        triggerMessage: trigger.message ?? "",
      });
      break;

    case TriggerAction.ADD_TO_ANNOTATION_QUEUE:
      await deps.addToAnnotationQueue({
        traceIds: [traceId],
        projectId: tenantId,
        annotators: (params.annotators ?? []).map((a) => a.id),
        userId: params.createdByUserId ?? "",
      });
      break;

    case TriggerAction.ADD_TO_DATASET:
      await addTraceToDataset({
        deps,
        trigger,
        traceId,
        tenantId,
        params,
      });
      break;
  }

  // Record TriggerSent for dedup
  await deps.triggers.recordSent({
    triggerId: trigger.id,
    traceId,
    projectId: tenantId,
  });

  // Update lastRunAt
  await deps.triggers.updateLastRunAt(trigger.id, tenantId);

  logger.info(
    { tenantId, traceId, triggerId: trigger.id, action: trigger.action },
    "Trigger fired",
  );
}

function buildTriggerData(
  traceId: string,
  tenantId: string,
  foldState: TraceSummaryData,
): { traceId: string; input: string; output: string; projectId: string; fullTrace: Trace } {
  return {
    traceId,
    input: foldState.computedInput ?? "",
    output: foldState.computedOutput ?? "",
    projectId: tenantId,
    // Stub trace — sendTriggerEmail/sendSlackWebhook only use traceId/input/output.
    // ADD_TO_DATASET fetches the full trace separately.
    fullTrace: { trace_id: traceId } as Trace,
  };
}

async function addTraceToDataset({
  deps,
  trigger,
  traceId,
  tenantId,
  params,
}: {
  deps: AlertTriggerReactorDeps;
  trigger: TriggerSummary;
  traceId: string;
  tenantId: string;
  params: ActionParams;
}): Promise<void> {
  if (!params.datasetId || !params.datasetMapping) {
    logger.warn(
      { tenantId, triggerId: trigger.id },
      "ADD_TO_DATASET trigger missing datasetId or datasetMapping",
    );
    return;
  }

  const trace = await deps.traceById(tenantId, traceId);

  if (!trace) {
    logger.warn(
      { tenantId, traceId, triggerId: trigger.id },
      "Trace not found for ADD_TO_DATASET action",
    );
    return;
  }

  const { mapping, expansions: expansionsArray } = params.datasetMapping;
  const expansions = new Set(
    expansionsArray.filter(
      (e): e is keyof typeof TRACE_EXPANSIONS => e in TRACE_EXPANSIONS,
    ),
  );

  const entries: DatasetRecordEntry[] = [];
  const now = Date.now();

  const mappedEntries = mapTraceToDatasetEntry(
    trace,
    mapping as TraceMapping,
    expansions,
    undefined,
    undefined,
  );

  for (let i = 0; i < mappedEntries.length; i++) {
    const entry = mappedEntries[i]!;
    const sanitizedEntry = Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [
        key,
        typeof value === "string" ? value.replace(/\u0000/g, "") : value,
      ]),
    );
    entries.push({
      id: `${now}-${i}`,
      selected: true,
      ...sanitizedEntry,
    });
  }

  await deps.addToDataset({
    datasetId: params.datasetId,
    projectId: tenantId,
    datasetRecords: entries,
  });
}
