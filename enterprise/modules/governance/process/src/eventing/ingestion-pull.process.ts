import {
  INGESTION_PULL_EVENT_TYPES,
  isValidPullSchedule,
  type IngestionPullConfiguredEventData,
  type IngestionPullProcessingEvent,
  type IngestionPullRunFailedEventData,
} from "@langwatch/enterprise-governance-contract";
import type {
  Event,
  IntentSpec,
  ProcessHandlerContext,
  ProcessIntent,
  ProcessManagerApplier,
} from "@langwatch/eventing";

import type { IngestionPullScheduler } from "../app/governance.members.ts";
import { isInCooldown, providerWaitFrom } from "../rules/ingestion-pull-cooldown.rules.ts";
import type { IngestionPullListingService } from "../services/ingestion-pull-listing.service.ts";
import type { IngestionPullService } from "../services/ingestion-pull.service.ts";
import {
  INGESTION_PULL_CONCURRENCY,
  INGESTION_PULL_LEASE_DURATION_MS,
  INGESTION_PULL_MAX_ATTEMPTS,
} from "../services/ingestion-pull.service.ts";
import {
  INGESTION_PULL_PROCESS_INTENT_TYPES,
  IngestionPullIntent,
  IngestionPullListingIntent,
  ingestionPullListingIntentSchema,
  ingestionPullRunIntentSchema,
} from "./ingestion-pull.intent.ts";

export const INGESTION_PULL_PROCESS_NAME = "ingestionPull" as const;
export const INGESTION_PULL_STALE_RUN_MS = 30 * 60 * 1_000;
/** A listing holds no cursor, so abandoning one costs at most a duplicate provider call. */
export const INGESTION_PULL_STALE_LISTING_MS = INGESTION_PULL_STALE_RUN_MS;

type IngestionPullEvent = IngestionPullProcessingEvent & Event;
type IngestionPullIntents = {
  [INGESTION_PULL_PROCESS_INTENT_TYPES.RUN]: IntentSpec<typeof ingestionPullRunIntentSchema>;
  [INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_AGENTS]: IntentSpec<
    typeof ingestionPullListingIntentSchema
  >;
  [INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_PEOPLE]: IntentSpec<
    typeof ingestionPullListingIntentSchema
  >;
};

type ListingInFlight = { requestId: string; startedAt: number };

/** The listing slots and `cooldownUntil` are absent on state written before they existed. */
export type IngestionPullProcessState = {
  sourceId: string;
  enabled: boolean;
  cron: string | null;
  cursor: string | null;
  currentRun: {
    runId: string;
    scheduledFor: number;
    startedAt: number;
  } | null;
  currentAgentsListing?: ListingInFlight | null;
  currentPeopleListing?: ListingInFlight | null;
  cooldownUntil?: number | null;
};

type ListingSlot = "currentAgentsListing" | "currentPeopleListing";

const INITIAL_STATE: IngestionPullProcessState = {
  sourceId: "",
  enabled: false,
  cron: null,
  cursor: null,
  currentRun: null,
  currentAgentsListing: null,
  currentPeopleListing: null,
};

type ProcessContext = ProcessHandlerContext<IngestionPullIntents>;
type Settled = {
  state: IngestionPullProcessState;
  nextWakeAt: number | null;
  intents: ProcessIntent[];
};

/** Owns each source's cron wake, pull runs, cursor, provider cooldown and on-demand listings. */
export class IngestionPullProcess {
  private constructor(
    private readonly schedule: IngestionPullScheduler,
    private readonly intent: IngestionPullIntent,
    private readonly listing: IngestionPullListingIntent,
  ) {}

  static create(options: {
    schedule: IngestionPullScheduler;
    execution: IngestionPullService;
    listing: IngestionPullListingService;
  }): IngestionPullProcess {
    return new IngestionPullProcess(
      options.schedule,
      IngestionPullIntent.create(options.execution),
      IngestionPullListingIntent.create(options.listing),
    );
  }

  processManager(): ProcessManagerApplier<IngestionPullEvent> {
    return (process) =>
      process
        .state(INITIAL_STATE)
        .intent(
          INGESTION_PULL_PROCESS_INTENT_TYPES.RUN,
          ingestionPullRunIntentSchema,
          (payload, context) => this.intent.execute(payload, context),
        )
        .intent(
          INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_AGENTS,
          ingestionPullListingIntentSchema,
          (payload, context) => this.listing.listAgents(payload, context),
        )
        .intent(
          INGESTION_PULL_PROCESS_INTENT_TYPES.LIST_PEOPLE,
          ingestionPullListingIntentSchema,
          (payload, context) => this.listing.listPeople(payload, context),
        )
        .on(INGESTION_PULL_EVENT_TYPES.CONFIGURED, (state, data, context) =>
          this.configured({ state, data, context }),
        )
        .on(INGESTION_PULL_EVENT_TYPES.DISABLED, (state, data) => ({
          state: {
            ...state,
            sourceId: data.sourceId,
            enabled: false,
            cron: null,
            currentRun: null,
            currentAgentsListing: null,
            currentPeopleListing: null,
          },
          nextWakeAt: null,
          intents: [],
        }))
        .on(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED, (state, data, context) => {
          const current = state.currentRun?.runId === data.runId;
          return this.settle({
            state: {
              ...state,
              cursor: current ? data.nextCursor : state.cursor,
              currentRun: current ? null : state.currentRun,
            },
            after: this.schedulingReference(context),
          });
        })
        .on(INGESTION_PULL_EVENT_TYPES.RUN_FAILED, (state, data, context) =>
          this.runFailed({ state, data, context }),
        )
        .on(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED, (state, data, context) =>
          this.listingRequested({
            state,
            request: data,
            context,
            slot: "currentAgentsListing",
            dispatch: (listing) =>
              context.intents.listAgents(`agents:${listing.requestId}`, listing),
          }),
        )
        .on(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED, (state, data, context) =>
          this.listingSettled({
            state,
            requestId: data.requestId,
            slot: "currentAgentsListing",
            context,
          }),
        )
        .on(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED, (state, data, context) =>
          this.listingSettled({
            state,
            requestId: data.requestId,
            slot: "currentAgentsListing",
            context,
          }),
        )
        .on(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED, (state, data, context) =>
          this.listingRequested({
            state,
            request: data,
            context,
            slot: "currentPeopleListing",
            dispatch: (listing) =>
              context.intents.listPeople(`people:${listing.requestId}`, listing),
          }),
        )
        .on(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED, (state, data, context) =>
          this.listingSettled({
            state,
            requestId: data.requestId,
            slot: "currentPeopleListing",
            context,
          }),
        )
        .on(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REFUSED, (state, data, context) =>
          this.listingSettled({
            state,
            requestId: data.requestId,
            slot: "currentPeopleListing",
            context,
          }),
        )
        .onWake((state, context) => this.wake(state, context))
        .outbox({
          maxAttempts: INGESTION_PULL_MAX_ATTEMPTS,
          leaseDurationMs: INGESTION_PULL_LEASE_DURATION_MS,
          concurrency: INGESTION_PULL_CONCURRENCY,
          batchSize: INGESTION_PULL_CONCURRENCY,
        });
  }

  private configured({
    state,
    data,
    context,
  }: {
    state: IngestionPullProcessState;
    data: IngestionPullConfiguredEventData;
    context: ProcessContext;
  }): Settled {
    if (!isValidPullSchedule(data.cron)) return { state, nextWakeAt: null, intents: [] };
    return this.settle({
      state: {
        ...state,
        sourceId: data.sourceId,
        enabled: true,
        cron: data.cron,
        cursor: state.sourceId ? state.cursor : data.cursor,
      },
      after: this.schedulingReference(context),
    });
  }

  private runFailed({
    state,
    data,
    context,
  }: {
    state: IngestionPullProcessState;
    data: IngestionPullRunFailedEventData;
    context: ProcessContext;
  }): Settled {
    const wait = providerWaitFrom({ retryAfterMs: data.retryAfterMs, refusedAt: context.at });
    const held = state.cooldownUntil ?? null;
    return this.settle({
      state: {
        ...state,
        currentRun: state.currentRun?.runId === data.runId ? null : state.currentRun,
        cooldownUntil: wait.outcome === "no_wait" ? held : Math.max(wait.at, held ?? 0),
      },
      after: this.schedulingReference(context),
    });
  }

  private schedulingReference(context: ProcessContext): number {
    return Math.max(context.at, context.now);
  }

  /** A tick inside a provider's wait moves to its end; the admin's cadence is never edited. */
  private settle(input: {
    state: IngestionPullProcessState;
    after: number;
    intents?: ProcessIntent[];
  }): Settled {
    const intents = input.intents ?? [];
    if (!input.state.enabled || !input.state.cron) {
      return { state: input.state, nextWakeAt: null, intents };
    }
    const scheduled = this.schedule.nextRunAt({ cron: input.state.cron, after: input.after });
    const cooldownUntil = input.state.cooldownUntil;
    return {
      state: input.state,
      nextWakeAt: cooldownUntil != null ? Math.max(scheduled, cooldownUntil) : scheduled,
      intents,
    };
  }

  /** A disabled source is not asked, and a second ask while one is in flight is dropped. */
  private listingRequested({
    state,
    request,
    context,
    slot,
    dispatch,
  }: {
    state: IngestionPullProcessState;
    request: { sourceId: string; requestId: string };
    context: ProcessContext;
    slot: ListingSlot;
    dispatch: (listing: {
      sourceId: string;
      requestId: string;
      requestedAt: number;
    }) => ProcessIntent;
  }): Settled {
    const after = this.schedulingReference(context);
    if (!state.enabled) return this.settle({ state, after });
    const inFlight = state[slot];
    const busy =
      inFlight != null &&
      inFlight.requestId !== request.requestId &&
      context.now - inFlight.startedAt < INGESTION_PULL_STALE_LISTING_MS;
    if (busy) return this.settle({ state, after });
    return this.settle({
      state: {
        ...state,
        sourceId: request.sourceId,
        [slot]: { requestId: request.requestId, startedAt: context.now },
      },
      after,
      intents: [
        dispatch({
          sourceId: request.sourceId,
          requestId: request.requestId,
          requestedAt: context.at,
        }),
      ],
    });
  }

  /** Frees the slot only for the request it names; a late outcome never cancels the live one. */
  private listingSettled({
    state,
    requestId,
    slot,
    context,
  }: {
    state: IngestionPullProcessState;
    requestId: string;
    slot: ListingSlot;
    context: ProcessContext;
  }): Settled {
    const current = state[slot]?.requestId === requestId;
    return this.settle({
      state: { ...state, [slot]: current ? null : (state[slot] ?? null) },
      after: this.schedulingReference(context),
    });
  }

  private wake(state: IngestionPullProcessState, context: ProcessContext): Settled {
    if (!state.enabled || !state.cron) {
      return { state, nextWakeAt: null, intents: [] };
    }
    const active =
      state.currentRun !== null &&
      context.now - state.currentRun.startedAt < INGESTION_PULL_STALE_RUN_MS;
    if (active) return this.settle({ state, after: context.now });
    if (isInCooldown({ cooldownUntil: state.cooldownUntil, now: context.now })) {
      return this.settle({ state, after: context.now });
    }

    const runId = String(context.at);
    const abandonedRunId = state.currentRun?.runId;
    return this.settle({
      state: {
        ...state,
        currentRun: {
          runId,
          scheduledFor: context.at,
          startedAt: context.now,
        },
      },
      after: context.now,
      intents: [
        context.intents.run(`pull:${runId}`, {
          sourceId: state.sourceId,
          runId,
          scheduledFor: context.at,
          cursor: state.cursor,
          ...(abandonedRunId !== undefined ? { abandonedRunId } : {}),
        }),
      ],
    });
  }
}
