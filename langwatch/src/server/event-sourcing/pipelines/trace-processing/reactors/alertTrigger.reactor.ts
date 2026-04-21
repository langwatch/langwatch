import type { PrismaClient } from "@prisma/client";
import { TriggerAction } from "@prisma/client";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  buildPreconditionTraceDataFromFoldState,
  classifyTriggerFilters,
  matchesTriggerFilters,
} from "~/server/filters/triggerFilter.matcher";
import { sendTriggerEmail } from "~/server/mailer/triggerEmail";
import { sendSlackWebhook } from "~/server/triggers/sendSlackWebhook";
import { createOrUpdateQueueItems } from "~/server/api/routers/annotation";
import { createManyDatasetRecords } from "~/server/api/routers/datasetRecord.utils";
import type { DatasetRecordEntry } from "~/server/datasets/types";
import {
  mapTraceToDatasetEntry,
  TRACE_EXPANSIONS,
  type TraceMapping,
} from "~/server/tracer/tracesMapping";
import type { Trace } from "~/server/tracer/types";
import { TraceService } from "~/server/traces/trace.service";
import { getProtectionsForProject } from "~/server/api/utils";
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
  prisma: PrismaClient;
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
          const alreadySent = await deps.prisma.triggerSent.findUnique({
            where: {
              triggerId_traceId: { triggerId: trigger.id, traceId },
              projectId: tenantId,
            },
          });
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
  const project = await deps.prisma.project.findUnique({
    where: { id: tenantId },
    select: { slug: true },
  });

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
      await createOrUpdateQueueItems({
        traceIds: [traceId],
        projectId: tenantId,
        annotators: (params.annotators ?? []).map((a) => a.id),
        userId: params.createdByUserId ?? "",
        prisma: deps.prisma,
      });
      break;

    case TriggerAction.ADD_TO_DATASET:
      await addTraceToDataset({
        deps,
        trigger,
        traceId,
        tenantId,
        foldState,
        params,
      });
      break;
  }

  // Record TriggerSent for dedup
  await deps.prisma.triggerSent.create({
    data: {
      triggerId: trigger.id,
      traceId,
      projectId: tenantId,
    },
  });

  // Update lastRunAt
  await deps.prisma.trigger.update({
    where: { id: trigger.id, projectId: tenantId },
    data: { lastRunAt: Date.now() },
  });

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
  foldState,
  params,
}: {
  deps: AlertTriggerReactorDeps;
  trigger: TriggerSummary;
  traceId: string;
  tenantId: string;
  foldState: TraceSummaryData;
  params: ActionParams;
}): Promise<void> {
  if (!params.datasetId || !params.datasetMapping) {
    logger.warn(
      { tenantId, triggerId: trigger.id },
      "ADD_TO_DATASET trigger missing datasetId or datasetMapping",
    );
    return;
  }

  // ADD_TO_DATASET needs the full trace with spans for mapping.
  const traceService = TraceService.create(deps.prisma);
  const protections = await getProtectionsForProject(deps.prisma, {
    projectId: tenantId,
  });

  const trace = await traceService.getById(tenantId, traceId, protections);

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

  await createManyDatasetRecords({
    datasetId: params.datasetId,
    projectId: tenantId,
    datasetRecords: entries,
  });
}
