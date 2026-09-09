import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import type {
  EventHandler,
  ProcessHandlerContext,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { ProcessIntent } from "~/server/event-sourcing/process-manager";

import {
  type IngestionPullProcessingEvent,
  isValidPullSchedule,
} from "../schemas/events";
import {
  type IngestionPullIntents,
  type IngestionPullProcessEventView,
  type IngestionPullProcessState,
  ingestionPullProcessEventViewSchema,
} from "./ingestionPullProcess.types";

/**
 * A run older than this no longer defers the next scheduled pull: its effect
 * is dead (the outbox lease plus retries are bounded well under it), so the
 * next wake abandons it and starts fresh from the durable cursor.
 */
export const INGESTION_PULL_STALE_RUN_MS = 30 * 60 * 1000;

/**
 * The same bound as a stale run, for the same reason (outbox lease times max
 * attempts is well under it), but named apart: a listing holds no cursor, so
 * abandoning one costs a duplicate provider call at worst and this number can
 * move on its own if that trade changes.
 */
export const INGESTION_PULL_STALE_LISTING_MS = INGESTION_PULL_STALE_RUN_MS;

/**
 * The longest wait a provider can talk us into.
 *
 * The wait is a number read out of a provider's answer, not one we choose.
 * Left unbounded, a single malformed answer parks a money source for years
 * with nothing on any screen explaining the silence. A day is long enough to
 * be a real cooldown and short enough that the worst case self-corrects.
 */
export const INGESTION_PULL_MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function nextWake({ cron, after }: { cron: string; after: number }): number {
  return computeNextRunAt({
    cron,
    timezone: "UTC",
    after: new Date(after),
  }).getTime();
}

/**
 * Turns a wait a provider named into the instant this connection may ask
 * again, or into nothing at all.
 *
 * The one place a provider's number becomes one of ours, so there is a single
 * rule rather than one per caller. Anything that is not a readable, positive
 * length of time is no wait: absent, null, NaN, infinite, zero or negative.
 * That answer used to be handed straight to the part that works out the next
 * run, which rejects what it cannot read — so one provider answering strangely
 * stopped every scheduled connection rather than the one it answered.
 */
export function cooldownUntilFrom({
  retryAfterMs,
  now,
}: {
  retryAfterMs: number | null | undefined;
  now: number;
}): number | null {
  if (retryAfterMs == null || !Number.isFinite(retryAfterMs)) return null;
  if (retryAfterMs <= 0) return null;
  return now + Math.min(retryAfterMs, INGESTION_PULL_MAX_COOLDOWN_MS);
}

/**
 * Whether a wait this connection was told about is still running.
 *
 * Absence is not a wait, and a wait whose instant has passed is not a wait,
 * so both read the same way here rather than at each call site.
 */
function inCooldown({
  state,
  now,
}: {
  state: IngestionPullProcessState;
  now: number;
}): boolean {
  return state.cooldownUntil != null && state.cooldownUntil > now;
}

/**
 * The content boundary (ADR-052): narrows a committed pull event to the
 * identities and cursors the process may see.
 */
export function buildProcessEventView(
  event: IngestionPullProcessingEvent,
): IngestionPullProcessEventView {
  return {
    sourceId: event.data.sourceId,
    cron: "cron" in event.data ? event.data.cron : null,
    cursor:
      "cursor" in event.data
        ? event.data.cursor
        : "nextCursor" in event.data
          ? event.data.nextCursor
          : null,
    runId: "runId" in event.data ? event.data.runId : null,
    requestId: "requestId" in event.data ? event.data.requestId : null,
    // A duration, not content: how long the provider asked to be left alone.
    // Written by a failure and read by the connection, which is the only way
    // a wait can outlive the run that was told about it.
    retryAfterMs:
      "retryAfterMs" in event.data ? (event.data.retryAfterMs ?? null) : null,
  };
}

export const INITIAL_INGESTION_PULL_STATE: IngestionPullProcessState = {
  sourceId: "",
  enabled: false,
  cron: null,
  cursor: null,
  currentRun: null,
  currentAgentsListing: null,
  currentPeopleListing: null,
};

type Ctx = ProcessHandlerContext<IngestionPullIntents>;

/**
 * Schedule from whichever is later: the event's business time or the instant
 * it is actually handled. An event replayed hours late would otherwise write
 * a nextWakeAt that is already in the past.
 */
function schedulingRef(ctx: Ctx): number {
  return Math.max(ctx.at, ctx.now);
}

function settle({
  state,
  after,
  intents = [],
}: {
  state: IngestionPullProcessState;
  after: number;
  intents?: ProcessIntent[];
}) {
  if (!state.enabled || !state.cron) {
    return { state, nextWakeAt: null, intents };
  }
  const scheduled = nextWake({ cron: state.cron, after });
  // Later of the two, never either alone. The cadence an admin chose is not
  // edited by a provider having a bad afternoon, and a tick falling inside a
  // wait is moved to the end of that wait rather than spent being refused.
  return {
    state,
    nextWakeAt:
      state.cooldownUntil != null
        ? Math.max(scheduled, state.cooldownUntil)
        : scheduled,
    intents,
  };
}

export const handlePullConfigured: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  // The command boundary validates the cron; this guard is for events that
  // were committed anyway. Throwing here would poison the subscriber forever
  // (evolve re-runs the same committed event on every retry), so degrade
  // instead: keep the previous state and stand down until a valid
  // reconfiguration arrives.
  if (view.cron === null || !isValidPullSchedule(view.cron)) {
    return { state, nextWakeAt: null, intents: [] };
  }
  return settle({
    state: {
      ...state,
      sourceId: view.sourceId,
      enabled: true,
      cron: view.cron,
      cursor: state.sourceId ? state.cursor : view.cursor,
    },
    after: schedulingRef(ctx),
  });
};

export const handlePullDisabled: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  return {
    state: {
      ...state,
      sourceId: view.sourceId,
      enabled: false,
      cron: null,
      currentRun: null,
      currentAgentsListing: null,
      currentPeopleListing: null,
    },
    nextWakeAt: null,
    intents: [],
  };
};

export const handlePullRunCompleted: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  // Only the run this process is currently tracking may advance the durable
  // cursor. A late completion from a superseded run would otherwise regress
  // the live cursor and re-ingest its window.
  const isCurrentRun = state.currentRun?.runId === view.runId;
  return settle({
    state: {
      ...state,
      cursor: isCurrentRun ? view.cursor : state.cursor,
      currentRun: isCurrentRun ? null : state.currentRun,
    },
    after: schedulingRef(ctx),
  });
};

export const handlePullRunFailed: EventHandler<
  IngestionPullProcessState,
  unknown,
  IngestionPullIntents
> = (state, payload, ctx) => {
  const view = ingestionPullProcessEventViewSchema.parse(payload);
  // The wait is kept whichever run was told about it, including a run this
  // process has already stopped tracking. A provider that asked for silence
  // asked the connection, and an abandoned run's wait is exactly the one that
  // used to die with it.
  const told = cooldownUntilFrom({
    retryAfterMs: view.retryAfterMs,
    now: ctx.now,
  });
  return settle({
    state: {
      ...state,
      currentRun:
        state.currentRun?.runId === view.runId ? null : state.currentRun,
      // Never shortens a wait already running: two refusals in a row leave the
      // later instant standing rather than the most recent one.
      cooldownUntil:
        told === null
          ? state.cooldownUntil
          : Math.max(told, state.cooldownUntil ?? 0),
    },
    after: schedulingRef(ctx),
  });
};

/**
 * Which listing a handler owns. The two are tracked in separate slots because
 * one in flight is no reason to refuse the other: they ask different providers
 * different questions.
 */
type ListingSlot = "currentAgentsListing" | "currentPeopleListing";

/**
 * Clears the listing this event is about, and leaves a listing it is not
 * about alone. Mirrors the `currentRun` guard: a late outcome from a
 * superseded request must not cancel the one actually in flight.
 */
function clearListing({
  state,
  requestId,
  slot,
}: {
  state: IngestionPullProcessState;
  requestId: string | null;
  slot: ListingSlot;
}): IngestionPullProcessState {
  const isCurrent = requestId !== null && state[slot]?.requestId === requestId;
  return { ...state, [slot]: isCurrent ? null : state[slot] };
}

/**
 * Turns one ask into one dispatched listing.
 *
 * Every arm settles through `settle`, so asking a source what it knows never
 * disturbs the pull schedule it is already keeping. That is the whole reason
 * this is not `handlePullConfigured`: that one settles the source to its next
 * cron tick, and an admin pressing a button is asking for now.
 *
 * One body for both lists. The rules it encodes — degrade on a missing
 * request id, drop a second ask while one is in flight, key the intent on the
 * request — are the same rules, and a second copy is a second chance for one
 * of them to be forgotten in a way that costs a source its next pull.
 */
function listingRequestedHandler({
  slot,
  dispatch,
}: {
  slot: ListingSlot;
  dispatch: (
    ctx: Ctx,
    args: { sourceId: string; requestId: string },
  ) => ProcessIntent;
}): EventHandler<IngestionPullProcessState, unknown, IngestionPullIntents> {
  return (state, payload, ctx) => {
    const view = ingestionPullProcessEventViewSchema.parse(payload);
    // Degrade rather than throw, like the configured handler: evolve re-runs a
    // committed event on every retry, so a malformed one would poison the
    // subscriber forever.
    if (view.requestId === null) {
      return settle({ state, after: schedulingRef(ctx) });
    }

    const inFlight = state[slot];
    const isBusy =
      inFlight != null &&
      inFlight.requestId !== view.requestId &&
      ctx.now - inFlight.startedAt < INGESTION_PULL_STALE_LISTING_MS;
    if (isBusy) {
      return settle({ state, after: schedulingRef(ctx) });
    }

    return settle({
      state: {
        ...state,
        sourceId: view.sourceId,
        [slot]: { requestId: view.requestId, startedAt: ctx.now },
      },
      after: schedulingRef(ctx),
      intents: [
        dispatch(ctx, {
          sourceId: view.sourceId,
          requestId: view.requestId,
        }),
      ],
    });
  };
}

/**
 * Frees the slot once a listing is over, however it ended.
 *
 * A refusal frees the source for another attempt exactly like a success does,
 * and both leave the pull schedule untouched: a provider declining to list
 * says nothing about whether it will serve the rows the pull reads. The count
 * lives in the event, not here — the process needs to know only that the
 * request is over.
 */
function listingSettledHandler({
  slot,
}: {
  slot: ListingSlot;
}): EventHandler<IngestionPullProcessState, unknown, IngestionPullIntents> {
  return (state, payload, ctx) => {
    const view = ingestionPullProcessEventViewSchema.parse(payload);
    return settle({
      state: clearListing({ state, requestId: view.requestId, slot }),
      after: schedulingRef(ctx),
    });
  };
}

export const handleAgentsListingRequested = listingRequestedHandler({
  slot: "currentAgentsListing",
  dispatch: (ctx, { sourceId, requestId }) =>
    // Keyed on the request, so a redelivery of this event dispatches the same
    // intent rather than a second one.
    ctx.intents.listAgents(`agents:${requestId}`, {
      sourceId,
      requestId,
      requestedAt: ctx.at,
    }),
});

export const handleAgentsListed = listingSettledHandler({
  slot: "currentAgentsListing",
});

export const handleAgentsListingRefused = listingSettledHandler({
  slot: "currentAgentsListing",
});

export const handlePeopleListingRequested = listingRequestedHandler({
  slot: "currentPeopleListing",
  dispatch: (ctx, { sourceId, requestId }) =>
    ctx.intents.listPeople(`people:${requestId}`, {
      sourceId,
      requestId,
      requestedAt: ctx.at,
    }),
});

export const handlePeopleListed = listingSettledHandler({
  slot: "currentPeopleListing",
});

export const handlePeopleListingRefused = listingSettledHandler({
  slot: "currentPeopleListing",
});

export const ingestionPullWake: WakeHandler<
  IngestionPullProcessState,
  IngestionPullIntents
> = (state, ctx) => {
  if (!state.enabled || !state.cron) {
    return { state, nextWakeAt: null, intents: [] };
  }

  const active =
    state.currentRun !== null &&
    ctx.now - state.currentRun.startedAt < INGESTION_PULL_STALE_RUN_MS;
  if (active) return settle({ state, after: ctx.now });

  // The wait is checked before a run is minted, not inside one. A replacement
  // that starts and then discovers the wait has already spent the provider
  // call the wait existed to prevent. `settle` moves the wake to the end of
  // the wait, so this returns rather than reschedules.
  if (inCooldown({ state, now: ctx.now })) {
    return settle({ state, after: ctx.now });
  }

  // Identity comes from the slot the wake was scheduled for (`ctx.at`), never
  // the handling instant: a redelivered wake must mint the same runId, or it
  // would start a second pull over the same window.
  const runId = String(ctx.at);
  // A run still tracked here at this point outlived its allowance and is being
  // taken over. It used to end without recording anything at all, so the
  // history showed a run that started and no run that finished. The
  // replacement carries its id and records the abandonment naming itself.
  const abandonedRunId = state.currentRun?.runId;
  return settle({
    state: {
      ...state,
      currentRun: { runId, scheduledFor: ctx.at, startedAt: ctx.now },
    },
    after: ctx.now,
    intents: [
      ctx.intents.run(`pull:${runId}`, {
        sourceId: state.sourceId,
        runId,
        scheduledFor: ctx.at,
        cursor: state.cursor,
        ...(abandonedRunId !== undefined ? { abandonedRunId } : {}),
      }),
    ],
  });
};
