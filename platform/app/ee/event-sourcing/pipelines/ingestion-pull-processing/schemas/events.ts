import { z } from "zod";

import { computeNextRunAt } from "~/server/app-layer/scheduler/nextRunAt";
import { EventSchema } from "~/server/event-sourcing/domain/types";
import {
  INGESTION_PULL_EVENT_TYPES,
  INGESTION_PULL_EVENT_VERSIONS,
} from "./constants";

const sourceEnvelope = z.object({ sourceId: z.string().min(1) });

/**
 * Write-side schedule guard. The command boundary is where an invalid cron
 * must be rejected: once committed, the event replays through the process
 * subscriber forever, so evolve can only degrade, not refuse.
 */
export const pullScheduleSchema = z
  .string()
  .min(1)
  .superRefine((cron, ctx) => {
    if (cron.trim().split(/\s+/).length !== 5) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pull schedule must be a five-field cron expression",
      });
      return;
    }
    try {
      computeNextRunAt({ cron, timezone: "UTC", after: new Date() });
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "pull schedule is not a valid cron expression",
      });
    }
  });

/**
 * The imperative face of pullScheduleSchema — one validator, two shapes.
 *
 * There is no `assert` variant here. The one that existed threw the zod
 * issues away and rethrew a plain `Error`, so an admin's cron typo arrived as
 * an unnamed 500; its only caller now raises a `ValidationError` that keeps
 * the issues (`ingestionSource.service.ts::assertPullSchedule`). The process
 * manager reads the boolean, because a cron already committed to the log has
 * to be skipped, not thrown over.
 */
export function isValidPullSchedule(cron: string): boolean {
  return pullScheduleSchema.safeParse(cron).success;
}

export const ingestionPullConfiguredEventDataSchema = sourceEnvelope.extend({
  // Deliberately permissive on the read path: a cron that slipped into the
  // log before write-side validation existed must still parse so replays
  // and projections cannot be poisoned by it.
  cron: z.string().min(1),
  configVersion: z.string().min(1),
  cursor: z.string().nullable(),
});
export type IngestionPullConfiguredEventData = z.infer<
  typeof ingestionPullConfiguredEventDataSchema
>;

/** Command-boundary variant of the configured data: schedule must be valid. */
export const ingestionPullConfiguredCommandDataSchema =
  ingestionPullConfiguredEventDataSchema.extend({
    cron: pullScheduleSchema,
  });

export const ingestionPullDisabledEventDataSchema = sourceEnvelope.extend({
  configVersion: z.string().min(1),
});
export type IngestionPullDisabledEventData = z.infer<
  typeof ingestionPullDisabledEventDataSchema
>;

export const ingestionPullRunCompletedEventDataSchema = sourceEnvelope.extend({
  runId: z.string().min(1),
  scheduledFor: z.number(),
  nextCursor: z.string().nullable(),
  eventCount: z.number().int().nonnegative(),
  /**
   * Items this run could not read while still advancing its cursor past them —
   * rows that failed to parse, a next-page link it refused to follow. Nonzero
   * means partial success: a run that reported errors WITHOUT advancing fails
   * outright and records `run_failed` instead, so it never reaches here.
   *
   * Optional rather than defaulted, and the difference is load-bearing here:
   * the fold reads events straight off the log without re-parsing them
   * (`AbstractFoldProjection.apply`), so a `.default(0)` would type the field
   * as always-present while every completion written before this change has no
   * such key. The reader owns the `?? 0`, and reading absence as a clean run is
   * right for that history — those producers had no notion of partial success.
   */
  errorCount: z.number().int().nonnegative().optional(),
  /**
   * Whether the run reached the end of what it set out to read.
   *
   * A truncated run is not a failed one — its money and audit rows are
   * written and its cursor advances — so this rides beside `errorCount`
   * rather than in it. It is the only evidence separating a source stuck
   * permanently on a fraction of its data from a healthy quiet one.
   *
   * Optional for the same reason `errorCount` above is: the fold reads events
   * straight off an append-only log, and every completion written before this
   * existed has no such key. Absent means "we do not know", which is the
   * honest answer for that history and must never render as either value.
   */
  completeness: z.enum(["complete", "truncated"]).optional(),
  /**
   * The instant the source is known to have been read up to, epoch ms.
   *
   * Deliberately NOT the instant the run finished. The run clock advances on
   * every attempt, so a stuck source re-reading the same half would look like
   * steady progress; this value does not move until the read does. Nullable
   * for a run that reached nowhere at all.
   */
  readThroughAt: z.number().nullable().optional(),
});
export type IngestionPullRunCompletedEventData = z.infer<
  typeof ingestionPullRunCompletedEventDataSchema
>;

/**
 * The provider refused the source outright and said so in a sentence we
 * wrote ourselves (`DispatchError.customerMessage`). It is the one failure
 * code whose `error` carries no provider reply, so the source page may show
 * that text as written; every other code collapses to a fixed sentence there.
 */
export const PULL_REFUSED_ERROR_CODE = "pull_refused" as const;
/**
 * The run ended without a sentence of ours to show: retries exhausted, or a
 * refusal that carried no customer message. `error` holds the diagnostic
 * detail for the log and must never reach the page.
 */
export const PULL_FAILED_ERROR_CODE = "pull_failed" as const;

export const ingestionPullRunFailedEventDataSchema = sourceEnvelope.extend({
  runId: z.string().min(1),
  scheduledFor: z.number(),
  error: z.string(),
  /**
   * Kept as a free string because the log is append-only and early failures
   * carry codes this file never named. Known values: `PULL_REFUSED_ERROR_CODE`,
   * `PULL_FAILED_ERROR_CODE`, and `run_abandoned` (written when a replacement
   * run takes over, see `replacedByRunId`).
   */
  errorCode: z.string(),
  retryable: z.boolean(),
  /**
   * How long the provider asked to be left alone, in milliseconds, when it
   * said so. Read off the answer, never chosen by us.
   *
   * It rides on the run that received it so the wait outlives that run: the
   * connection reads it back and holds every later attempt, including the
   * replacement of an abandoned run, which is the whole point. Nullable for a
   * provider that named no wait, and optional because the log is append-only
   * and every failure written before this existed carries no such key.
   */
  retryAfterMs: z.number().nullable().optional(),
  /**
   * The run that took this one's place, when this run ended because it was
   * replaced rather than because the provider refused it.
   *
   * Present only on an abandonment. Without it the history says a run stopped
   * and cannot say what continued the work, which is the difference between a
   * source that gave up and a source that is still reading.
   */
  replacedByRunId: z.string().optional(),
});
export type IngestionPullRunFailedEventData = z.infer<
  typeof ingestionPullRunFailedEventDataSchema
>;

const listingEnvelope = sourceEnvelope.extend({
  /**
   * Identity of one ask. Two presses of the same button are two requests with
   * two ids, because they are two asks; a redelivery of one press carries the
   * id it was minted with, so it settles onto the same event.
   */
  requestId: z.string().min(1),
});

export const ingestionPullAgentsListingRequestedEventDataSchema =
  listingEnvelope;
export type IngestionPullAgentsListingRequestedEventData = z.infer<
  typeof ingestionPullAgentsListingRequestedEventDataSchema
>;

export const ingestionPullAgentsListedEventDataSchema = listingEnvelope.extend({
  requestedAt: z.number(),
  /**
   * How many agents the provider named, and therefore how many sightings were
   * recorded. Zero is the whole of "the provider returned an empty list": a
   * refusal never reaches this event, so a zero here cannot mean anything
   * else. That is what keeps the two readable apart after the fact.
   */
  agentCount: z.number().int().nonnegative(),
});
export type IngestionPullAgentsListedEventData = z.infer<
  typeof ingestionPullAgentsListedEventDataSchema
>;

export const ingestionPullAgentsListingRefusedEventDataSchema =
  listingEnvelope.extend({
    requestedAt: z.number(),
    /**
     * A `ListingRefusalReason`, or `LISTING_FAILED_REASON` when we
     * never got to ask. Deliberately a plain string and not the enum: the log
     * outlives the enum, so a reason retired in a later release must still
     * replay. Readers key their copy off the values they know and fall back
     * for the rest.
     */
    reason: z.string().min(1),
    /** The provider's HTTP status, when the refusal came with one. */
    status: z.number().int().nullable(),
  });
export type IngestionPullAgentsListingRefusedEventData = z.infer<
  typeof ingestionPullAgentsListingRefusedEventDataSchema
>;

export const ingestionPullPeopleListingRequestedEventDataSchema =
  listingEnvelope;
export type IngestionPullPeopleListingRequestedEventData = z.infer<
  typeof ingestionPullPeopleListingRequestedEventDataSchema
>;

export const ingestionPullPeopleListedEventDataSchema = listingEnvelope.extend({
  requestedAt: z.number(),
  /**
   * Everyone the provider's directory named. A fact about the provider, and
   * the direct counterpart of `agentCount`.
   *
   * Zero is the whole of "the provider returned an empty list": a refusal
   * never reaches this event, so a zero here cannot mean anything else.
   *
   * `withheldPersonCount` is a SUBSET of this number, never an addition to
   * it. Adding the two counts the same people twice. Subtracting is the valid
   * arithmetic: what this deployment holds is the directory count minus the
   * withheld count, which is why that total is derived and not a third field.
   */
  directoryPersonCount: z.number().int().nonnegative(),
  /**
   * How many of the people named above this deployment does not hold, because
   * erasure suppression removed them. A fact about our own obligations, not
   * about the provider.
   *
   * A SUBSET of `directoryPersonCount`, never an addition to it. Adding the
   * two counts the same people twice. Subtracting is the valid arithmetic.
   *
   * Both numbers travel because the surviving total alone is lossy: a tenant
   * that erased everyone a provider still lists would otherwise read as a
   * provider naming nobody, which is a false statement about a system working
   * exactly as intended, and it sends an admin to debug a healthy provider.
   *
   * Where this number may go is decided by who can read the sink, not by
   * whether the sink holds one figure or a history. Our own stores may keep
   * it per run: this event log and the run status row sit inside our
   * boundary, under our retention, readable only by those we granted this
   * tenant's data to. That per-run history is deliberate — an operator
   * entitled to it needs to see the count move.
   *
   * It must not reach a sink outside that boundary, telemetry export above
   * all: a span leaves over a plain exporter to a backend with its own
   * retention and a reader set of every engineer with a dashboard login. The
   * test is the reach, not the shape, so even a single current figure on a
   * span is already too far.
   *
   * What that reach would expose: this number stepping from N to N+1 at a
   * known moment says an erasure happened then, and on a small tenant that
   * identifies the person as surely as a name would. The same fact limits
   * what the product may draw with it — a CURRENT figure only, no trend line,
   * no history drawer, and never beside a per-person list, where a drop from
   * 500 to 499 is the same disclosure.
   *
   * Adding a new sink: ask who can read it. If that is anyone beyond the
   * readers of this tenant's data, the count does not go there.
   */
  withheldPersonCount: z.number().int().nonnegative(),
});
export type IngestionPullPeopleListedEventData = z.infer<
  typeof ingestionPullPeopleListedEventDataSchema
>;

export const ingestionPullPeopleListingRefusedEventDataSchema =
  listingEnvelope.extend({
    requestedAt: z.number(),
    /**
     * A `ListingRefusalReason`, or `LISTING_FAILED_REASON` when we never got
     * to ask. A plain string and not the enum for the reason the agent
     * refusal gives: the log outlives the enum.
     */
    reason: z.string().min(1),
    /** The provider's HTTP status, when the refusal came with one. */
    status: z.number().int().nullable(),
  });
export type IngestionPullPeopleListingRefusedEventData = z.infer<
  typeof ingestionPullPeopleListingRefusedEventDataSchema
>;

export const IngestionPullConfiguredEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.CONFIGURED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.CONFIGURED),
  data: ingestionPullConfiguredEventDataSchema,
});
export const IngestionPullDisabledEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.DISABLED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.DISABLED),
  data: ingestionPullDisabledEventDataSchema,
});
export const IngestionPullRunCompletedEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.RUN_COMPLETED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.RUN_COMPLETED),
  data: ingestionPullRunCompletedEventDataSchema,
});
export const IngestionPullRunFailedEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.RUN_FAILED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.RUN_FAILED),
  data: ingestionPullRunFailedEventDataSchema,
});

export type IngestionPullConfiguredEvent = z.infer<
  typeof IngestionPullConfiguredEventSchema
>;
export type IngestionPullDisabledEvent = z.infer<
  typeof IngestionPullDisabledEventSchema
>;
export type IngestionPullRunCompletedEvent = z.infer<
  typeof IngestionPullRunCompletedEventSchema
>;
export type IngestionPullRunFailedEvent = z.infer<
  typeof IngestionPullRunFailedEventSchema
>;

export const IngestionPullAgentsListingRequestedEventSchema =
  EventSchema.extend({
    type: z.literal(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REQUESTED),
    version: z.literal(INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REQUESTED),
    data: ingestionPullAgentsListingRequestedEventDataSchema,
  });
export const IngestionPullAgentsListedEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTED),
  data: ingestionPullAgentsListedEventDataSchema,
});
export const IngestionPullAgentsListingRefusedEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.AGENTS_LISTING_REFUSED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.AGENTS_LISTING_REFUSED),
  data: ingestionPullAgentsListingRefusedEventDataSchema,
});

export type IngestionPullAgentsListingRequestedEvent = z.infer<
  typeof IngestionPullAgentsListingRequestedEventSchema
>;
export type IngestionPullAgentsListedEvent = z.infer<
  typeof IngestionPullAgentsListedEventSchema
>;
export type IngestionPullAgentsListingRefusedEvent = z.infer<
  typeof IngestionPullAgentsListingRefusedEventSchema
>;

export const IngestionPullPeopleListingRequestedEventSchema =
  EventSchema.extend({
    type: z.literal(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REQUESTED),
    version: z.literal(INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTING_REQUESTED),
    data: ingestionPullPeopleListingRequestedEventDataSchema,
  });
export const IngestionPullPeopleListedEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTED),
  data: ingestionPullPeopleListedEventDataSchema,
});
export const IngestionPullPeopleListingRefusedEventSchema = EventSchema.extend({
  type: z.literal(INGESTION_PULL_EVENT_TYPES.PEOPLE_LISTING_REFUSED),
  version: z.literal(INGESTION_PULL_EVENT_VERSIONS.PEOPLE_LISTING_REFUSED),
  data: ingestionPullPeopleListingRefusedEventDataSchema,
});

export type IngestionPullPeopleListingRequestedEvent = z.infer<
  typeof IngestionPullPeopleListingRequestedEventSchema
>;
export type IngestionPullPeopleListedEvent = z.infer<
  typeof IngestionPullPeopleListedEventSchema
>;
export type IngestionPullPeopleListingRefusedEvent = z.infer<
  typeof IngestionPullPeopleListingRefusedEventSchema
>;

export type IngestionPullProcessingEvent =
  | IngestionPullConfiguredEvent
  | IngestionPullDisabledEvent
  | IngestionPullRunCompletedEvent
  | IngestionPullRunFailedEvent
  | IngestionPullAgentsListingRequestedEvent
  | IngestionPullAgentsListedEvent
  | IngestionPullAgentsListingRefusedEvent
  | IngestionPullPeopleListingRequestedEvent
  | IngestionPullPeopleListedEvent
  | IngestionPullPeopleListingRefusedEvent;
