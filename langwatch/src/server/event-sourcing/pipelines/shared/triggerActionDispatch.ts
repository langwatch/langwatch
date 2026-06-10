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
import {
  CADENCE_WINDOW_MS,
  type NotificationCadence,
} from "~/automations/cadences";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:trigger-action-dispatch");

/**
 * Trigger actions split into two classes that dispatch on different schedules.
 * See dev/docs/adr/026-per-trigger-dispatch-timing.md.
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

/**
 * Resolves when a matched trigger should dispatch. This is the contract the
 * outbox dispatch layer reads:
 *
 * - Persist actions and immediate-cadence notify actions fire now.
 * - Digest-cadence notify actions snap to the **next wall-clock boundary**
 *   for their window (e.g. for `5min_digest`, the next UTC multiple of
 *   5 minutes since the epoch). All matches inside the same boundary share
 *   one dispatch time, which is what lets the GroupQueue's `processBatch`
 *   + `coalesceMaxBatch` collapse them into a single digest invocation.
 *
 * Snapping (not `now + window`) is load-bearing — `now + window` gives every
 * match its own scheduled-for, so concurrent matches end up at slightly
 * different times and never coalesce. See ADR-026.
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
  const windowMs = CADENCE_WINDOW_MS[cadence];
  const nowMs = now.getTime();
  // Next wall-clock boundary: ceil(nowMs / window) * window.
  // If now is already exactly on a boundary, advance one full window so two
  // matches at the same instant don't dispatch "now" on the boundary and
  // skip the digest behavior the operator picked.
  const nextBoundaryMs = (Math.floor(nowMs / windowMs) + 1) * windowMs;
  return new Date(nextBoundaryMs);
}

/**
 * Wired by the registry on the worker (composition root), `undefined`
 * on the web process and in unit tests that don't care about the
 * outbox. When set, NOTIFY-class matches route through the unified
 * outbox queue (`stage: "settle"`) so the settle dispatcher does the
 * filter recheck + claim + cadence enqueue. Persist-class actions
 * always run inline regardless of this setting — they want every
 * match to land immediately.
 */
export type EnqueueSettle = (params: {
  projectId: string;
  triggerId: string;
  traceId: string;
  foldState: TraceSummaryData;
  /** Per-trigger settle-window TTL (ADR-026). When omitted, the registry
   *  falls back to `DEFAULT_TRACE_DEBOUNCE_MS`. */
  traceDebounceMs?: number;
}) => Promise<void>;

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
  enqueueSettle?: EnqueueSettle;
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

  let dispatched = true;

  switch (trigger.action) {
    case TriggerAction.SEND_EMAIL:
      await sendTriggerEmail({
        triggerEmails: params.members ?? [],
        triggerData: [triggerData],
        triggerName: trigger.name,
        triggerId: trigger.id,
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
      if (!params.createdByUserId) {
        // Mirror the missing-datasetId guard: an empty-string userId would
        // create queue items attributed to no valid user.
        logger.warn(
          { tenantId, triggerId: trigger.id },
          "ADD_TO_ANNOTATION_QUEUE trigger missing createdByUserId; skipping action",
        );
        dispatched = false;
        break;
      }
      await deps.addToAnnotationQueue({
        traceIds: [traceId],
        projectId: tenantId,
        annotators: (params.annotators ?? []).map((a) => a.id),
        userId: params.createdByUserId,
      });
      break;

    case TriggerAction.ADD_TO_DATASET:
      dispatched = await addTraceToDataset({
        deps,
        trigger,
        traceId,
        tenantId,
        params,
        fullTrace,
      });
      break;
  }

  if (!dispatched) {
    // The action did not actually run (missing config / trace data) —
    // don't record the trigger as having fired.
    logger.warn(
      { tenantId, traceId, triggerId: trigger.id, action: trigger.action },
      "Trigger action skipped; not updating lastRunAt",
    );
    return;
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
