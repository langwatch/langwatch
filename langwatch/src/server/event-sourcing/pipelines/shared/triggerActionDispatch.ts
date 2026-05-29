import { TriggerAction } from "@prisma/client";
import type { TriggerSummary } from "~/server/app-layer/triggers/repositories/trigger.repository";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { TriggerService } from "~/server/app-layer/triggers/trigger.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
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

const logger = createLogger("langwatch:trigger-action-dispatch");

/**
 * Trigger actions split into two classes that dispatch on different schedules.
 * See dev/docs/adr/025-notify-persistent-action-classification.md.
 *
 * - Notify actions land in front of a human; they may be batched into a digest
 *   window to avoid notification storms.
 * - Persist actions write durable data the customer asked for; batching them
 *   would defeat the intent, so they always dispatch immediately.
 *
 * The two sets must together cover every TriggerAction value, with no overlap
 * (enforced by the unit test). A new action type must be classified here at the
 * point it is introduced.
 */
export const NOTIFY_TRIGGER_ACTIONS = new Set<TriggerAction>([
  TriggerAction.SEND_EMAIL,
  TriggerAction.SEND_SLACK_MESSAGE,
]);

export const PERSIST_TRIGGER_ACTIONS = new Set<TriggerAction>([
  TriggerAction.ADD_TO_DATASET,
  TriggerAction.ADD_TO_ANNOTATION_QUEUE,
]);

export const NOTIFICATION_CADENCES = [
  "immediate",
  "5min_digest",
  "15min_digest",
  "hourly_digest",
] as const;

export type NotificationCadence = (typeof NOTIFICATION_CADENCES)[number];

export const CADENCE_WINDOW_MS: Record<NotificationCadence, number> = {
  immediate: 0,
  "5min_digest": 5 * 60 * 1000,
  "15min_digest": 15 * 60 * 1000,
  hourly_digest: 60 * 60 * 1000,
};

/**
 * Resolves when a matched trigger should dispatch. This is the contract the
 * outbox dispatch layer reads: persist actions and immediate-cadence notify
 * actions fire now; digest-cadence notify actions open a window that closes
 * `CADENCE_WINDOW_MS` later.
 */
export function computeScheduledFor({
  action,
  cadence,
  now,
}: {
  action: TriggerAction;
  cadence: NotificationCadence;
  now: Date;
}): Date {
  if (PERSIST_TRIGGER_ACTIONS.has(action)) return now;
  if (cadence === "immediate") return now;
  return new Date(now.getTime() + CADENCE_WINDOW_MS[cadence]);
}

export interface TriggerActionDispatchDeps {
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

export async function dispatchTriggerAction({
  deps,
  trigger,
  traceId,
  tenantId,
  foldState,
}: {
  deps: TriggerActionDispatchDeps;
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

  // Fetch full trace once — used by Slack (events), email (events), and ADD_TO_DATASET (mapping).
  // Best-effort: if trace not found, actions that only need input/output still work with a stub.
  const fullTrace = await deps.traceById(tenantId, traceId) ?? { trace_id: traceId } as Trace;

  const triggerData = buildTriggerData(traceId, tenantId, foldState, fullTrace);
  const params = (trigger.actionParams ?? {}) as ActionParams;

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
        fullTrace,
      });
      break;
  }

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
  fullTrace: Trace,
): { traceId: string; input: string; output: string; projectId: string; fullTrace: Trace } {
  return {
    traceId,
    input: foldState.computedInput ?? "",
    output: foldState.computedOutput ?? "",
    projectId: tenantId,
    fullTrace,
  };
}

async function addTraceToDataset({
  deps,
  trigger,
  traceId,
  tenantId,
  params,
  fullTrace,
}: {
  deps: TriggerActionDispatchDeps;
  trigger: TriggerSummary;
  traceId: string;
  tenantId: string;
  params: ActionParams;
  fullTrace: Trace;
}): Promise<boolean> {
  if (!params.datasetId || !params.datasetMapping) {
    logger.warn(
      { tenantId, triggerId: trigger.id },
      "ADD_TO_DATASET trigger missing datasetId or datasetMapping",
    );
    return false;
  }

  // Full trace was already fetched by dispatchTriggerAction; check it has spans
  if (!fullTrace.spans || fullTrace.spans.length === 0) {
    logger.warn(
      { tenantId, traceId, triggerId: trigger.id },
      "Trace not found or has no spans for ADD_TO_DATASET action",
    );
    return false;
  }

  const trace = fullTrace;

  const { mapping, expansions: expansionsArray } = params.datasetMapping;
  const expansions = new Set(
    expansionsArray.filter(
      (e): e is keyof typeof TRACE_EXPANSIONS => e in TRACE_EXPANSIONS,
    ),
  );

  const entries: DatasetRecordEntry[] = [];

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
      id: `${trigger.id}-${traceId}-${i}`,
      selected: true,
      ...sanitizedEntry,
    });
  }

  await deps.addToDataset({
    datasetId: params.datasetId,
    projectId: tenantId,
    datasetRecords: entries,
  });

  return true;
}
