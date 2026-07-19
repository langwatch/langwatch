import crypto from "crypto";

import type {
  Evolution,
  ProcessDefinition,
  ProcessEventEnvelope,
  ProcessInput,
  ProcessIntent,
} from "~/server/event-sourcing/process-manager";
import { TOPIC_CLUSTERING_EVENT_TYPES } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/constants";
import type { TopicClusteringProcessingEvent } from "~/server/event-sourcing/pipelines/topic-clustering-processing/schemas/events";

import {
  TOPIC_CLUSTERING_PROCESS_INTENT_TYPES,
  TOPIC_CLUSTERING_PROCESS_NAME,
  topicClusteringProcessEventViewSchema,
  type TopicClusteringProcessEventView,
  type TopicClusteringProcessState,
  type TopicClusteringRunIntent,
} from "./topicClusteringProcess.types";

/**
 * A run that has shown no durable activity for this long is considered
 * abandoned: the daily wake stops deferring to it and starts a fresh run.
 * Kept under the 24h wake period so one lost completion event cannot block
 * scheduling for more than a day; comfortably above the outbox retry
 * horizon so a healthy backlog walk (which refreshes `updatedAtMs` on every
 * page) is never preempted.
 */
export const TOPIC_CLUSTERING_STALE_RUN_MS = 20 * 60 * 60 * 1000;

/**
 * The legacy fan-out spread each project's daily BullMQ job by hashing the
 * project id over the day. The wake slot preserves that exact computation
 * (including parseInt's float rounding of the 256-bit hex — deterministic,
 * and slot-compatible with what projects had before ADR-051).
 */
function dailySlotOffsetMs(projectId: string): number {
  const hash = crypto.createHash("sha256");
  hash.update(projectId);
  const hashNumber = parseInt(hash.digest("hex"), 16);
  const distributionHour = hashNumber % 24;
  const distributionMinute = hashNumber % 60;
  return distributionHour * 60 * 60 * 1000 + distributionMinute * 60 * 1000;
}

/** The next occurrence of the project's daily slot strictly after `afterMs`. */
export function nextDailySlot(projectId: string, afterMs: number): number {
  const offset = dailySlotOffsetMs(projectId);
  const dayStart = Date.UTC(
    new Date(afterMs).getUTCFullYear(),
    new Date(afterMs).getUTCMonth(),
    new Date(afterMs).getUTCDate(),
  );
  const candidate = dayStart + offset;
  return candidate > afterMs ? candidate : candidate + 24 * 60 * 60 * 1000;
}

/** `20260717` — the scheduled run identity for the slot's UTC day. */
function runIdForSlot(slotMs: number): string {
  return new Date(slotMs).toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * Maps a committed pipeline event to the generic process envelope. In this
 * pipeline the event's TenantId IS the projectId and the aggregate is the
 * project, so processKey = projectId.
 */
export function toTopicClusteringProcessEnvelope(
  event: TopicClusteringProcessingEvent,
): ProcessEventEnvelope {
  return {
    eventId: event.id,
    eventType: event.type,
    occurredAt: event.occurredAt,
    tenantId: String(event.tenantId),
    projectId: String(event.tenantId),
    processKey: String(event.aggregateId),
    payload: buildProcessEventView(event),
  };
}

function buildProcessEventView(
  event: TopicClusteringProcessingEvent,
): TopicClusteringProcessEventView {
  return {
    trigger: "trigger" in event.data ? event.data.trigger : null,
    runId: "runId" in event.data ? event.data.runId : null,
    page: "page" in event.data ? event.data.page : null,
    hasNextPage:
      "nextSearchAfter" in event.data && event.data.nextSearchAfter != null,
    nextSearchAfter:
      "nextSearchAfter" in event.data ? (event.data.nextSearchAfter ?? null) : null,
  };
}

const INITIAL_STATE: TopicClusteringProcessState = {
  projectId: "",
  enabled: false,
  currentRun: null,
};

function runIntent(params: TopicClusteringRunIntent): ProcessIntent {
  return {
    messageKey: `run:${params.runId}:page-${params.page}`,
    intentType: TOPIC_CLUSTERING_PROCESS_INTENT_TYPES.RUN,
    payload: params,
  };
}

function settle(
  state: TopicClusteringProcessState,
  refMs: number,
  intents: ProcessIntent[] = [],
): Evolution<TopicClusteringProcessState> {
  // Every commit reschedules the daily slot; the wake-time in-flight guard
  // (not wake suppression) is what prevents run pile-ups.
  return {
    state,
    nextWakeAt: state.enabled && state.projectId
      ? nextDailySlot(state.projectId, refMs)
      : null,
    intents,
  };
}

/**
 * Whether an outcome event belongs to the run the process currently believes
 * is in flight. Outcomes are delivered at least once and can arrive long
 * after a stale-run recovery has moved on, so identity — not arrival order —
 * decides whether an outcome may touch `currentRun`.
 */
function isCurrentRun(
  state: TopicClusteringProcessState,
  runId: string,
): boolean {
  return state.currentRun?.runId === runId;
}

function evolveEvent(
  previousState: TopicClusteringProcessState,
  envelope: ProcessEventEnvelope,
): Evolution<TopicClusteringProcessState> {
  const view = topicClusteringProcessEventViewSchema.parse(envelope.payload);
  const occurredAt = envelope.occurredAt;
  const base: TopicClusteringProcessState = {
    ...previousState,
    projectId: envelope.processKey,
    enabled: true,
  };

  switch (envelope.eventType) {
    case TOPIC_CLUSTERING_EVENT_TYPES.REQUESTED: {
      if (view.trigger !== "manual") {
        // Bootstrap: ensure the process exists and the first wake is set.
        return settle(base, occurredAt);
      }
      if (base.currentRun !== null) {
        // A run is already walking the backlog; the projection shows it.
        return settle(base, occurredAt);
      }
      const runId = `manual-${occurredAt}`;
      return settle(
        {
          ...base,
          currentRun: { runId, page: 1, updatedAtMs: occurredAt },
        },
        occurredAt,
        [runIntent({ runId, page: 1, searchAfter: null })],
      );
    }

    case TOPIC_CLUSTERING_EVENT_TYPES.RUN_COMPLETED: {
      if (view.runId === null || view.page === null) {
        return settle(base, occurredAt);
      }
      if (!isCurrentRun(previousState, view.runId)) {
        // A late outcome from a superseded run. Acting on it would resurrect
        // the old run as `currentRun` and emit a continuation intent, so two
        // backlog walks would page the same project at once, each refreshing
        // the other's in-flight guard. The live run owns the project.
        return settle(base, occurredAt);
      }
      if (!view.hasNextPage) {
        return settle({ ...base, currentRun: null }, occurredAt);
      }
      const nextPage = view.page + 1;
      return settle(
        {
          ...base,
          currentRun: {
            runId: view.runId,
            page: nextPage,
            updatedAtMs: occurredAt,
          },
        },
        occurredAt,
        [
          runIntent({
            runId: view.runId,
            page: nextPage,
            searchAfter: view.nextSearchAfter,
          }),
        ],
      );
    }

    case TOPIC_CLUSTERING_EVENT_TYPES.RUN_FAILED:
      if (view.runId !== null && !isCurrentRun(previousState, view.runId)) {
        // Mirror of the completion guard: a late failure from a superseded
        // run must not null out the LIVE run, or the next wake would start a
        // third run alongside the one still walking the backlog.
        return settle(base, occurredAt);
      }
      return settle({ ...base, currentRun: null }, occurredAt);

    default:
      return settle(base, occurredAt);
  }
}

function evolveWake(
  previousState: TopicClusteringProcessState,
  scheduledFor: number,
  now: number,
): Evolution<TopicClusteringProcessState> {
  if (!previousState.enabled || !previousState.projectId) {
    // A wake for a process that was never bootstrapped decides nothing and
    // must clear itself, or the wake worker would re-find it forever.
    return { state: previousState, nextWakeAt: null, intents: [] };
  }

  // Clamp the reference instant to the present. A wake that fires late (the
  // fleet was down for days) must schedule the NEXT slot from now, not from
  // the slot it missed — otherwise every skipped day is replayed as its own
  // run within seconds of recovery. Clustering re-derives its work from live
  // unassigned traces, so one catch-up run covers the whole gap (ADR-051:
  // "a schedule gap after recovery self-heals").
  const refMs = Math.max(scheduledFor, now);

  const inFlight =
    previousState.currentRun !== null &&
    refMs - previousState.currentRun.updatedAtMs <
      TOPIC_CLUSTERING_STALE_RUN_MS;
  if (inFlight) {
    // An active backlog walk owns the project; skip this slot.
    return settle(previousState, refMs);
  }

  const runId = runIdForSlot(refMs);
  return settle(
    {
      ...previousState,
      currentRun: { runId, page: 1, updatedAtMs: refMs },
    },
    refMs,
    [runIntent({ runId, page: 1, searchAfter: null })],
  );
}

export const topicClusteringProcessDefinition: ProcessDefinition<TopicClusteringProcessState> =
  {
    name: TOPIC_CLUSTERING_PROCESS_NAME,
    initialState: INITIAL_STATE,
    evolve: ({
      previousState,
      input,
    }: {
      previousState: TopicClusteringProcessState;
      input: ProcessInput;
    }) => {
      if (input.kind === "event") {
        return evolveEvent(previousState, input.event);
      }
      return evolveWake(previousState, input.scheduledFor, input.now);
    },
  };
