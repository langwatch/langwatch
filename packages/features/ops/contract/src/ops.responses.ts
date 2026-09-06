/**
 * What the `ops.*` tRPC surface ANSWERS.
 *
 * Most of it is the operations vocabulary the other modules here already
 * declare — a queue page, a process instance, a replay run — reused rather
 * than restated. What is new is the shapes the SURFACE invents: the operator's
 * own scope probe, the acknowledgements the writes answer with, and the two
 * process-level readings (the pipeline registry and the event-log window) that
 * belong to no service.
 *
 * Every acknowledgement is its own named schema rather than one shared
 * `{ ok: true }`: they carry different counts, and a caller reading
 * `jobsRemoved` off a drain must not typecheck against a replay.
 */
import { z } from "zod";
import { searchProjectsResultSchema } from "@langwatch/project-contract";
import { anomalySchema } from "./ops-anomaly";
import {
  deadLetterCountSchema,
  deadOutboxMessageViewSchema,
  processInstanceRowSchema,
  processOutboxMessageViewSchema,
} from "./ops-process";
import { opsScheduledJobSchema } from "./ops-scheduler";
import {
  aggregateEventViewSchema,
  aggregateDiscoverySchema,
  aggregateSearchResultSchema,
  projectionStateAtEventSchema,
} from "./ops-event-log";

/**
 * The operator's reach, as the process resolved it.
 *
 * `none` is an answer rather than a refusal so the global menu can poll the
 * probe on every page load without spamming the console.
 */
export const opsScopeSchema = z.union([
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("platform") }).strict(),
]);
export type OpsScope = z.infer<typeof opsScopeSchema>;

/** What the status probe answers, for any authenticated caller. */
export const opsScopeProbeSchema = z.object({ scope: opsScopeSchema }).strict();

/**
 * What `ops.getBadgeCounts` answers — the two integers the navigation badge
 * renders, and when they were computed.
 *
 * `computedAt` is nullable here and not on the collector's own reading: those
 * zeroes mean "we cannot say" rather than "nothing is wrong", and stamping the
 * current time beside them would present unavailable data as a fresh
 * all-clear.
 */
export const opsApiGetBadgeCountsOutputSchema = z
  .object({
    blockedCount: z.number(),
    dlqCount: z.number(),
    computedAt: z.date().nullable(),
  })
  .strict();
export type OpsApiGetBadgeCountsOutput = z.infer<typeof opsApiGetBadgeCountsOutputSchema>;

// ---------------------------------------------------------------------------
// The process's own readings
// ---------------------------------------------------------------------------

/**
 * One registered projection, as the process's pipeline registry knows it.
 *
 * Named fields, not `unknown` — a tRPC procedure publishes what its handler
 * returns, so an `unknown` here is what the browser gets, and every ops
 * surface reading a projection row was reading its fields off `{}`.
 */
export const opsProjectionRegistrationSchema = z.object({
  projectionName: z.string(),
  pipelineName: z.string(),
  aggregateType: z.string(),
  /** Whether the projection is declared on a pipeline or registered globally. */
  source: z.enum(["pipeline", "global"]),
  /** The queue path a pause targets. */
  pauseKey: z.string(),
  kind: z.enum(["fold", "map", "state"]),
});
export type OpsProjectionRegistration = z.infer<typeof opsProjectionRegistrationSchema>;

/** One registered event subscriber, and the event types it reacts to. */
export const opsEventSubscriberRegistrationSchema = z.object({
  subscriberName: z.string(),
  pipelineName: z.string(),
  aggregateType: z.string(),
  /** The event types this subscriber reacts to — its transition triggers. */
  eventTypes: z.array(z.string()).readonly(),
});
export type OpsEventSubscriberRegistration = z.infer<typeof opsEventSubscriberRegistrationSchema>;

/** The registered projections and event subscribers, in one reading. */
export const opsPipelineRegistrationsSchema = z.object({
  projections: z.array(opsProjectionRegistrationSchema),
  eventSubscribers: z.array(opsEventSubscriberRegistrationSchema),
});

/**
 * The bound on an event-log search: the default lookback the explorer uses and
 * the env-derived hot-tier window, so the surface can say up front where reads
 * get slower.
 */
export const opsEventLogSearchWindowSchema = z.object({
  searchLookbackDays: z.number(),
  hotTierDays: z.number().nullable(),
  hotTierEnvVar: z.string().nullable(),
});

/** Grafana deep-link configuration; null when no Grafana is configured. */
export const opsGrafanaLinkConfigSchema = z
  .object({
    baseUrl: z.string(),
    tempoDatasourceUid: z.string().optional(),
    lokiDatasourceUid: z.string().optional(),
  })
  .nullable();

// ---------------------------------------------------------------------------
// Queue acknowledgements
// ---------------------------------------------------------------------------

/** Whether the group was blocked before the act — false means nothing moved. */
export const opsQueueUnblockedGroupSchema = z.object({ wasBlocked: z.boolean() });
export const opsQueueUnblockedAllSchema = z.object({ unblockedCount: z.number() });
export const opsQueueDrainedGroupSchema = z.object({ jobsRemoved: z.number() });
export const opsQueueDrainedTenantSchema = z.object({
  groupsDrained: z.number(),
  jobsDrained: z.number(),
});
export const opsQueueMovedToDlqSchema = z.object({ jobsMoved: z.number() });
export const opsQueueMovedAllToDlqSchema = z.object({
  movedCount: z.number(),
  jobsMoved: z.number(),
});
export const opsQueueReplayedFromDlqSchema = z.object({ jobsReplayed: z.number() });
export const opsQueueReplayedAllFromDlqSchema = z.object({
  replayedCount: z.number(),
  jobsReplayed: z.number(),
});
export const opsQueueRedrivenDlqGroupsSchema = z.object({
  redrivenCount: z.number(),
  jobsRedriven: z.number(),
});
export const opsQueueDiscardedDlqGroupsSchema = z.object({
  discardedCount: z.number(),
  jobsDiscarded: z.number(),
});
/** A canary names the groups it touched, so the operator can check them. */
export const opsQueueCanaryRedrivenSchema = z.object({
  redrivenCount: z.number(),
  groupIds: z.array(z.string()),
});
export const opsQueueCanaryUnblockedSchema = z.object({
  unblockedCount: z.number(),
  groupIds: z.array(z.string()),
});

/** The queue names a pause or a listing answers with. */
export const opsQueueNameListSchema = z.array(z.string());

// ---------------------------------------------------------------------------
// Scheduler and process-manager pages
// ---------------------------------------------------------------------------

/**
 * The switched-off schedules, with the total so the panel can say how many
 * exist rather than how many it drew.
 */
export const opsPausedSchedulesPageSchema = z.object({
  schedules: z.array(opsScheduledJobSchema),
  total: z.number(),
});

/** Retired messages across the fleet, with the per-process split beside them. */
export const opsDeadLetterPageSchema = z.object({
  messages: z.array(deadOutboxMessageViewSchema),
  total: z.number(),
  byProcess: z.array(deadLetterCountSchema),
});

export const opsProcessInstancePageSchema = z.object({
  instances: z.array(processInstanceRowSchema),
  total: z.number(),
});

export const opsProcessOutboxPageSchema = z.object({
  messages: z.array(processOutboxMessageViewSchema),
  total: z.number(),
});

// ---------------------------------------------------------------------------
// Process-manager acknowledgements
// ---------------------------------------------------------------------------

export const opsProcessRequeuedSchema = z.object({ requeued: z.number() });
export const opsProcessWokeSchema = z.object({ woke: z.boolean() });
export const opsProcessRedrivenMessageSchema = z.object({ redriven: z.boolean() });
export const opsProcessDiscardedMessageSchema = z.object({ discarded: z.boolean() });
export const opsProcessRedrivenDeadLettersSchema = z.object({ redriven: z.number() });
export const opsProcessDiscardedDeadLettersSchema = z.object({ discarded: z.number() });
export const opsProcessReleasedLeaseSchema = z.object({ released: z.boolean() });

// ---------------------------------------------------------------------------
// Event log, replay and anomalies
// ---------------------------------------------------------------------------

/** The tenant picker's answer: the projects the operator's query matched. */
export const opsTenantSearchSchema = z.array(searchProjectsResultSchema);

export const opsAggregateDiscoverySchema = aggregateDiscoverySchema;
export const opsAggregateSearchSchema = z.array(aggregateSearchResultSchema);
export const opsAggregateEventsSchema = z.array(aggregateEventViewSchema);
export const opsProjectionStateSchema = projectionStateAtEventSchema;

/**
 * The dry run's placeholder answer. Stated rather than left implicit because
 * the page renders `status` and `message` today, and a real dry run replacing
 * this has to keep answering something the page can read.
 */
export const opsDryRunReplaySchema = z.object({
  status: z.literal("coming_soon"),
  message: z.string(),
  projectionNames: z.array(z.string()),
  sampleSize: z.number(),
});

/** The started run's id. The status query is what reports its progress. */
export const opsReplayStartedSchema = z.object({ runId: z.string() });
export const opsReplayCancelledSchema = z.object({ cancelled: z.boolean() });

/** Active tenant anomalies, hard tier first. */
export const opsAnomalyListingSchema = z.object({ anomalies: z.array(anomalySchema) });
/** False when the anomaly had already cleared, which is not a failure. */
export const opsAnomalyDismissedSchema = z.object({ dismissed: z.boolean() });

// ---------------------------------------------------------------------------
// System migrations
// ---------------------------------------------------------------------------

export const opsMigrationEnrolledSchema = z.object({ enrolled: z.literal(true) });
export const opsMigrationWithdrawnSchema = z.object({ withdrawn: z.literal(true) });
export const opsMigrationPassStartedSchema = z.object({ started: z.literal(true) });
export const opsMigrationDrainAssertedSchema = z.object({ asserted: z.literal(true) });
export const opsMigrationRolledBackSchema = z.object({ rolledBack: z.literal(true) });
