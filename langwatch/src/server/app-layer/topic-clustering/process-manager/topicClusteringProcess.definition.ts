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
 * A run that began this long ago is considered abandoned: the daily wake
 * stops deferring to it and starts a fresh run, and a manual request may
 * preempt it.
 *
 * Measured from the run's START, not its last page. Measuring from the last
 * page made this bound unenforceable: a backlog walk refreshes `updatedAtMs`
 * on every page, so a walk that starts at its slot and stalls five hours in
 * still looks fresh at the next slot, defers it, and only recovers a day
 * later — 48h of no clustering against a documented ≤24h. Sitting under the
 * 24h wake period is what makes "one lost completion event cannot block
 * scheduling for more than a day" actually true.
 */
export const TOPIC_CLUSTERING_STALE_RUN_MS = 20 * 60 * 60 * 1000;

/**
 * Whether a run should still be treated as owning the project at `refMs`.
 * Rows written before `startedAtMs` existed fall back to `updatedAtMs`.
 */
function isRunInFlight(
  state: TopicClusteringProcessState,
  refMs: number,
): boolean {
  const run = state.currentRun;
  if (run === null) return false;
  const startedAtMs = run.startedAtMs ?? run.updatedAtMs;
  return refMs - startedAtMs < TOPIC_CLUSTERING_STALE_RUN_MS;
}

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
  now: number,
): Evolution<TopicClusteringProcessState> {
  const view = topicClusteringProcessEventViewSchema.parse(envelope.payload);
  const eventAt = envelope.occurredAt;
  // Clamp the scheduling reference to the present, exactly as the wake branch
  // does. `occurredAt` is business time, so a backed-up subscriber can deliver
  // an event whose next daily slot has ALREADY passed. Scheduling from it
  // writes a nextWakeAt in the past; that wake fires at once, regenerates a
  // messageKey the outbox already dispatched, and the duplicate insert is
  // dropped — leaving `currentRun` set with no intent in flight and a day of
  // clustering silently skipped.
  const refMs = Math.max(eventAt, now);
  const base: TopicClusteringProcessState = {
    ...previousState,
    projectId: envelope.processKey,
    enabled: true,
  };

  switch (envelope.eventType) {
    case TOPIC_CLUSTERING_EVENT_TYPES.REQUESTED: {
      if (view.trigger !== "manual") {
        // Bootstrap: ensure the process exists and the first wake is set.
        return settle(base, refMs);
      }
      if (isRunInFlight(base, refMs)) {
        // A live run is walking the backlog; the projection shows it.
        return settle(base, refMs);
      }
      // A run that is merely RECORDED — stale, its effect long dead — must not
      // swallow the request. Deferring to it made "Run now" a silent no-op for
      // as long as the wedge lasted while the UI reported success, which is
      // exactly the state a user presses the button in.
      //
      // Identity comes from business time, never `refMs`: a redelivered
      // request must mint the same runId, or it would start a second run.
      const runId = `manual-${eventAt}`;
      return settle(
        {
          ...base,
          currentRun: {
            runId,
            page: 1,
            updatedAtMs: refMs,
            startedAtMs: refMs,
          },
        },
        refMs,
        [runIntent({ runId, page: 1, searchAfter: null })],
      );
    }

    case TOPIC_CLUSTERING_EVENT_TYPES.RUN_COMPLETED: {
      if (view.runId === null || view.page === null) {
        return settle(base, refMs);
      }
      if (!isCurrentRun(previousState, view.runId)) {
        // A late outcome from a superseded run. Acting on it would resurrect
        // the old run as `currentRun` and emit a continuation intent, so two
        // backlog walks would page the same project at once, each refreshing
        // the other's in-flight guard. The live run owns the project.
        return settle(base, refMs);
      }
      if (!view.hasNextPage) {
        return settle({ ...base, currentRun: null }, refMs);
      }
      const nextPage = view.page + 1;
      return settle(
        {
          ...base,
          currentRun: {
            runId: view.runId,
            page: nextPage,
            updatedAtMs: refMs,
            // Carry the original start forward. Restamping it per page would
            // make a walk immortal: every completed page would push the
            // stale-run deadline out and no wake could ever reclaim it.
            startedAtMs:
              previousState.currentRun?.startedAtMs ??
              previousState.currentRun?.updatedAtMs ??
              refMs,
          },
        },
        refMs,
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
        return settle(base, refMs);
      }
      return settle({ ...base, currentRun: null }, refMs);

    default:
      return settle(base, refMs);
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

  if (isRunInFlight(previousState, refMs)) {
    // An active backlog walk owns the project; skip this slot.
    return settle(previousState, refMs);
  }

  const runId = runIdForSlot(refMs);
  return settle(
    {
      ...previousState,
      currentRun: { runId, page: 1, updatedAtMs: refMs, startedAtMs: refMs },
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
        return evolveEvent(previousState, input.event, input.now);
      }
      return evolveWake(previousState, input.scheduledFor, input.now);
    },
  };
