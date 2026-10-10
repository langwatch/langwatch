import type { Named } from "@langwatch/module";
import { searchProjectsResultSchema } from "@langwatch/project-contract";
/**
 * What the `ops.*` tRPC surface answers. Every acknowledgement is its own
 * named schema rather than one shared `{ ok: true }`, so a caller reading
 * `jobsRemoved` off a drain cannot typecheck against a replay.
 */
import { z } from "zod";

import { anomalySchema } from "./features/dashboard/ops-anomaly.ts";
import {
  aggregateEventViewSchema,
  aggregateDiscoverySchema,
  aggregateSearchResultSchema,
  projectionStateAtEventSchema,
} from "./features/event-log/ops-event-log.ts";
import {
  deadLetterCountSchema,
  deadOutboxMessageViewSchema,
  processInstanceRowSchema,
  processOutboxMessageViewSchema,
} from "./features/process/ops-process.ts";
import { opsScheduledJobSchema } from "./ops-scheduler.ts";

/**
 * The operator's reach, as the process resolved it. `none` is an answer
 * rather than a refusal, so the global menu can poll the probe on every
 * page load without spamming the console.
 */
const opsScopeSchemaDefinition = z.union([
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("platform") }).strict(),
]);
export interface OpsScopeSchema extends Named<typeof opsScopeSchemaDefinition> {}
export const opsScopeSchema: OpsScopeSchema = opsScopeSchemaDefinition;
export type OpsScope = z.infer<typeof opsScopeSchema>;

/**
 * The operator behind a request. `impersonator` is the real admin behind an
 * impersonation session - it keeps an impersonating operator an operator on
 * a read, and refuses them on a write nobody would notice the damage of.
 */
const opsOperatorSchemaDefinition = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  impersonator: z
    .object({
      /** Absent on a door that reads only the address; the account holding it is looked up. */
      id: z.string().optional(),
      email: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});
export interface OpsOperatorSchema extends Named<typeof opsOperatorSchemaDefinition> {}
export const opsOperatorSchema: OpsOperatorSchema = opsOperatorSchemaDefinition;
export type OpsOperator = z.infer<typeof opsOperatorSchema>;

/** The two grains the operator surface is gated at: reads and writes. */
export type OpsOperatorPermission = "ops:view" | "ops:manage";

/** What the status probe answers, for any authenticated caller. */
const opsScopeProbeSchemaDefinition = z.object({ scope: opsScopeSchema }).strict();
export interface OpsScopeProbeSchema extends Named<typeof opsScopeProbeSchemaDefinition> {}
export const opsScopeProbeSchema: OpsScopeProbeSchema = opsScopeProbeSchemaDefinition;

/**
 * What `ops.getBadgeCounts` answers. `computedAt` is nullable because a
 * zero count can mean "we cannot say" rather than "nothing is wrong", and a
 * current timestamp beside it would present that as a fresh all-clear.
 */
const opsApiGetBadgeCountsOutputSchemaDefinition = z
  .object({
    blockedCount: z.number(),
    dlqCount: z.number(),
    computedAt: z.date().nullable(),
  })
  .strict();
export interface OpsApiGetBadgeCountsOutputSchema extends Named<
  typeof opsApiGetBadgeCountsOutputSchemaDefinition
> {}
export const opsApiGetBadgeCountsOutputSchema: OpsApiGetBadgeCountsOutputSchema =
  opsApiGetBadgeCountsOutputSchemaDefinition;
export type OpsApiGetBadgeCountsOutput = z.infer<typeof opsApiGetBadgeCountsOutputSchema>;

// ---------------------------------------------------------------------------
// The process's own readings
// ---------------------------------------------------------------------------

/**
 * One registered projection, as the pipeline registry knows it. Named
 * fields, not `unknown` - a tRPC procedure publishes what its handler
 * returns, so `unknown` here is what the browser would get.
 */
const opsProjectionRegistrationSchemaDefinition = z.object({
  projectionName: z.string(),
  pipelineName: z.string(),
  aggregateType: z.string(),
  /** Whether the projection is declared on a pipeline or registered globally. */
  source: z.enum(["pipeline", "global"]),
  /** The queue path a pause targets. */
  pauseKey: z.string(),
  kind: z.enum(["fold", "map", "state"]),
});
export interface OpsProjectionRegistrationSchema extends Named<
  typeof opsProjectionRegistrationSchemaDefinition
> {}
export const opsProjectionRegistrationSchema: OpsProjectionRegistrationSchema =
  opsProjectionRegistrationSchemaDefinition;
export type OpsProjectionRegistration = z.infer<typeof opsProjectionRegistrationSchema>;

/** One registered event subscriber, and the event types it reacts to. */
const opsEventSubscriberRegistrationSchemaDefinition = z.object({
  subscriberName: z.string(),
  pipelineName: z.string(),
  aggregateType: z.string(),
  /** The event types this subscriber reacts to - its transition triggers. */
  eventTypes: z.array(z.string()).readonly(),
});
export interface OpsEventSubscriberRegistrationSchema extends Named<
  typeof opsEventSubscriberRegistrationSchemaDefinition
> {}
export const opsEventSubscriberRegistrationSchema: OpsEventSubscriberRegistrationSchema =
  opsEventSubscriberRegistrationSchemaDefinition;
export type OpsEventSubscriberRegistration = z.infer<typeof opsEventSubscriberRegistrationSchema>;

/** The registered projections and event subscribers, in one reading. */
const opsPipelineRegistrationsSchemaDefinition = z.object({
  projections: z.array(opsProjectionRegistrationSchema),
  eventSubscribers: z.array(opsEventSubscriberRegistrationSchema),
});
export interface OpsPipelineRegistrationsSchema extends Named<
  typeof opsPipelineRegistrationsSchemaDefinition
> {}
export const opsPipelineRegistrationsSchema: OpsPipelineRegistrationsSchema =
  opsPipelineRegistrationsSchemaDefinition;
export type OpsPipelineRegistrations = z.infer<typeof opsPipelineRegistrationsSchema>;

/**
 * The bound on an event-log search: the default lookback the explorer uses and
 * the env-derived hot-tier window, so the surface can say up front where reads
 * get slower.
 */
const opsEventLogSearchWindowSchemaDefinition = z.object({
  searchLookbackDays: z.number(),
  hotTierDays: z.number().nullable(),
  hotTierEnvVar: z.string().nullable(),
});
export interface OpsEventLogSearchWindowSchema extends Named<
  typeof opsEventLogSearchWindowSchemaDefinition
> {}
export const opsEventLogSearchWindowSchema: OpsEventLogSearchWindowSchema =
  opsEventLogSearchWindowSchemaDefinition;
export type OpsEventLogSearchWindow = z.infer<typeof opsEventLogSearchWindowSchema>;

/** Grafana deep-link configuration; null when no Grafana is configured. */
const opsGrafanaLinkConfigSchemaDefinition = z
  .object({
    baseUrl: z.string(),
    tempoDatasourceUid: z.string().optional(),
    lokiDatasourceUid: z.string().optional(),
  })
  .nullable();
export interface OpsGrafanaLinkConfigSchema extends Named<
  typeof opsGrafanaLinkConfigSchemaDefinition
> {}
export const opsGrafanaLinkConfigSchema: OpsGrafanaLinkConfigSchema =
  opsGrafanaLinkConfigSchemaDefinition;
export type OpsGrafanaLinkConfig = z.infer<typeof opsGrafanaLinkConfigSchema>;

// ---------------------------------------------------------------------------
// Queue acknowledgements
// ---------------------------------------------------------------------------

/** Whether the group was blocked before the act - false means nothing moved. */
const opsQueueUnblockedGroupSchemaDefinition = z.object({ wasBlocked: z.boolean() });
export interface OpsQueueUnblockedGroupSchema extends Named<
  typeof opsQueueUnblockedGroupSchemaDefinition
> {}
export const opsQueueUnblockedGroupSchema: OpsQueueUnblockedGroupSchema =
  opsQueueUnblockedGroupSchemaDefinition;
const opsQueueUnblockedAllSchemaDefinition = z.object({ unblockedCount: z.number() });
export interface OpsQueueUnblockedAllSchema extends Named<
  typeof opsQueueUnblockedAllSchemaDefinition
> {}
export const opsQueueUnblockedAllSchema: OpsQueueUnblockedAllSchema =
  opsQueueUnblockedAllSchemaDefinition;
const opsQueueDrainedGroupSchemaDefinition = z.object({ jobsRemoved: z.number() });
export interface OpsQueueDrainedGroupSchema extends Named<
  typeof opsQueueDrainedGroupSchemaDefinition
> {}
export const opsQueueDrainedGroupSchema: OpsQueueDrainedGroupSchema =
  opsQueueDrainedGroupSchemaDefinition;
const opsQueueDrainedTenantSchemaDefinition = z.object({
  groupsDrained: z.number(),
  jobsDrained: z.number(),
});
export interface OpsQueueDrainedTenantSchema extends Named<
  typeof opsQueueDrainedTenantSchemaDefinition
> {}
export const opsQueueDrainedTenantSchema: OpsQueueDrainedTenantSchema =
  opsQueueDrainedTenantSchemaDefinition;
const opsQueueMovedToDlqSchemaDefinition = z.object({ jobsMoved: z.number() });
export interface OpsQueueMovedToDlqSchema extends Named<
  typeof opsQueueMovedToDlqSchemaDefinition
> {}
export const opsQueueMovedToDlqSchema: OpsQueueMovedToDlqSchema =
  opsQueueMovedToDlqSchemaDefinition;
const opsQueueMovedAllToDlqSchemaDefinition = z.object({
  movedCount: z.number(),
  jobsMoved: z.number(),
});
export interface OpsQueueMovedAllToDlqSchema extends Named<
  typeof opsQueueMovedAllToDlqSchemaDefinition
> {}
export const opsQueueMovedAllToDlqSchema: OpsQueueMovedAllToDlqSchema =
  opsQueueMovedAllToDlqSchemaDefinition;
const opsQueueReplayedFromDlqSchemaDefinition = z.object({ jobsReplayed: z.number() });
export interface OpsQueueReplayedFromDlqSchema extends Named<
  typeof opsQueueReplayedFromDlqSchemaDefinition
> {}
export const opsQueueReplayedFromDlqSchema: OpsQueueReplayedFromDlqSchema =
  opsQueueReplayedFromDlqSchemaDefinition;
const opsQueueReplayedAllFromDlqSchemaDefinition = z.object({
  replayedCount: z.number(),
  jobsReplayed: z.number(),
});
export interface OpsQueueReplayedAllFromDlqSchema extends Named<
  typeof opsQueueReplayedAllFromDlqSchemaDefinition
> {}
export const opsQueueReplayedAllFromDlqSchema: OpsQueueReplayedAllFromDlqSchema =
  opsQueueReplayedAllFromDlqSchemaDefinition;
const opsQueueRedrivenDlqGroupsSchemaDefinition = z.object({
  redrivenCount: z.number(),
  jobsRedriven: z.number(),
});
export interface OpsQueueRedrivenDlqGroupsSchema extends Named<
  typeof opsQueueRedrivenDlqGroupsSchemaDefinition
> {}
export const opsQueueRedrivenDlqGroupsSchema: OpsQueueRedrivenDlqGroupsSchema =
  opsQueueRedrivenDlqGroupsSchemaDefinition;
const opsQueueDiscardedDlqGroupsSchemaDefinition = z.object({
  discardedCount: z.number(),
  jobsDiscarded: z.number(),
});
export interface OpsQueueDiscardedDlqGroupsSchema extends Named<
  typeof opsQueueDiscardedDlqGroupsSchemaDefinition
> {}
export const opsQueueDiscardedDlqGroupsSchema: OpsQueueDiscardedDlqGroupsSchema =
  opsQueueDiscardedDlqGroupsSchemaDefinition;
/** A canary names the groups it touched, so the operator can check them. */
const opsQueueCanaryRedrivenSchemaDefinition = z.object({
  redrivenCount: z.number(),
  groupIds: z.array(z.string()),
});
export interface OpsQueueCanaryRedrivenSchema extends Named<
  typeof opsQueueCanaryRedrivenSchemaDefinition
> {}
export const opsQueueCanaryRedrivenSchema: OpsQueueCanaryRedrivenSchema =
  opsQueueCanaryRedrivenSchemaDefinition;
const opsQueueCanaryUnblockedSchemaDefinition = z.object({
  unblockedCount: z.number(),
  groupIds: z.array(z.string()),
});
export interface OpsQueueCanaryUnblockedSchema extends Named<
  typeof opsQueueCanaryUnblockedSchemaDefinition
> {}
export const opsQueueCanaryUnblockedSchema: OpsQueueCanaryUnblockedSchema =
  opsQueueCanaryUnblockedSchemaDefinition;

/** The queue names a pause or a listing answers with. */
const opsQueueNameListSchemaDefinition = z.array(z.string());
export interface OpsQueueNameListSchema extends Named<typeof opsQueueNameListSchemaDefinition> {}
export const opsQueueNameListSchema: OpsQueueNameListSchema = opsQueueNameListSchemaDefinition;

// ---------------------------------------------------------------------------
// Scheduler and process-manager pages
// ---------------------------------------------------------------------------

/**
 * The switched-off schedules, with the total so the panel can say how many
 * exist rather than how many it drew.
 */
const opsPausedSchedulesPageSchemaDefinition = z.object({
  schedules: z.array(opsScheduledJobSchema),
  total: z.number(),
});
export interface OpsPausedSchedulesPageSchema extends Named<
  typeof opsPausedSchedulesPageSchemaDefinition
> {}
export const opsPausedSchedulesPageSchema: OpsPausedSchedulesPageSchema =
  opsPausedSchedulesPageSchemaDefinition;

/** Retired messages across the fleet, with the per-process split beside them. */
const opsDeadLetterPageSchemaDefinition = z.object({
  messages: z.array(deadOutboxMessageViewSchema),
  total: z.number(),
  byProcess: z.array(deadLetterCountSchema),
});
export interface OpsDeadLetterPageSchema extends Named<typeof opsDeadLetterPageSchemaDefinition> {}
export const opsDeadLetterPageSchema: OpsDeadLetterPageSchema = opsDeadLetterPageSchemaDefinition;

const opsProcessInstancePageSchemaDefinition = z.object({
  instances: z.array(processInstanceRowSchema),
  total: z.number(),
});
export interface OpsProcessInstancePageSchema extends Named<
  typeof opsProcessInstancePageSchemaDefinition
> {}
export const opsProcessInstancePageSchema: OpsProcessInstancePageSchema =
  opsProcessInstancePageSchemaDefinition;

const opsProcessOutboxPageSchemaDefinition = z.object({
  messages: z.array(processOutboxMessageViewSchema),
  total: z.number(),
});
export interface OpsProcessOutboxPageSchema extends Named<
  typeof opsProcessOutboxPageSchemaDefinition
> {}
export const opsProcessOutboxPageSchema: OpsProcessOutboxPageSchema =
  opsProcessOutboxPageSchemaDefinition;

// ---------------------------------------------------------------------------
// Process-manager acknowledgements
// ---------------------------------------------------------------------------

const opsProcessRequeuedSchemaDefinition = z.object({ requeued: z.number() });
export interface OpsProcessRequeuedSchema extends Named<
  typeof opsProcessRequeuedSchemaDefinition
> {}
export const opsProcessRequeuedSchema: OpsProcessRequeuedSchema =
  opsProcessRequeuedSchemaDefinition;
const opsProcessWokeSchemaDefinition = z.object({ woke: z.boolean() });
export interface OpsProcessWokeSchema extends Named<typeof opsProcessWokeSchemaDefinition> {}
export const opsProcessWokeSchema: OpsProcessWokeSchema = opsProcessWokeSchemaDefinition;
const opsProcessRedrivenMessageSchemaDefinition = z.object({ redriven: z.boolean() });
export interface OpsProcessRedrivenMessageSchema extends Named<
  typeof opsProcessRedrivenMessageSchemaDefinition
> {}
export const opsProcessRedrivenMessageSchema: OpsProcessRedrivenMessageSchema =
  opsProcessRedrivenMessageSchemaDefinition;
const opsProcessDiscardedMessageSchemaDefinition = z.object({ discarded: z.boolean() });
export interface OpsProcessDiscardedMessageSchema extends Named<
  typeof opsProcessDiscardedMessageSchemaDefinition
> {}
export const opsProcessDiscardedMessageSchema: OpsProcessDiscardedMessageSchema =
  opsProcessDiscardedMessageSchemaDefinition;
const opsProcessRedrivenDeadLettersSchemaDefinition = z.object({ redriven: z.number() });
export interface OpsProcessRedrivenDeadLettersSchema extends Named<
  typeof opsProcessRedrivenDeadLettersSchemaDefinition
> {}
export const opsProcessRedrivenDeadLettersSchema: OpsProcessRedrivenDeadLettersSchema =
  opsProcessRedrivenDeadLettersSchemaDefinition;
const opsProcessDiscardedDeadLettersSchemaDefinition = z.object({ discarded: z.number() });
export interface OpsProcessDiscardedDeadLettersSchema extends Named<
  typeof opsProcessDiscardedDeadLettersSchemaDefinition
> {}
export const opsProcessDiscardedDeadLettersSchema: OpsProcessDiscardedDeadLettersSchema =
  opsProcessDiscardedDeadLettersSchemaDefinition;
const opsProcessReleasedLeaseSchemaDefinition = z.object({ released: z.boolean() });
export interface OpsProcessReleasedLeaseSchema extends Named<
  typeof opsProcessReleasedLeaseSchemaDefinition
> {}
export const opsProcessReleasedLeaseSchema: OpsProcessReleasedLeaseSchema =
  opsProcessReleasedLeaseSchemaDefinition;

// ---------------------------------------------------------------------------
// Event log, replay and anomalies
// ---------------------------------------------------------------------------

/** The tenant picker's answer: the projects the operator's query matched. */
const opsTenantSearchSchemaDefinition = z.array(searchProjectsResultSchema);
export interface OpsTenantSearchSchema extends Named<typeof opsTenantSearchSchemaDefinition> {}
export const opsTenantSearchSchema: OpsTenantSearchSchema = opsTenantSearchSchemaDefinition;

export const opsAggregateDiscoverySchema = aggregateDiscoverySchema;
const opsAggregateSearchSchemaDefinition = z.array(aggregateSearchResultSchema);
export interface OpsAggregateSearchSchema extends Named<
  typeof opsAggregateSearchSchemaDefinition
> {}
export const opsAggregateSearchSchema: OpsAggregateSearchSchema =
  opsAggregateSearchSchemaDefinition;
const opsAggregateEventsSchemaDefinition = z.array(aggregateEventViewSchema);
export interface OpsAggregateEventsSchema extends Named<
  typeof opsAggregateEventsSchemaDefinition
> {}
export const opsAggregateEventsSchema: OpsAggregateEventsSchema =
  opsAggregateEventsSchemaDefinition;
export const opsProjectionStateSchema = projectionStateAtEventSchema;

/**
 * The dry run's placeholder answer. Stated rather than left implicit because
 * the page renders `status` and `message` today, and a real dry run replacing
 * this has to keep answering something the page can read.
 */
const opsDryRunReplaySchemaDefinition = z.object({
  status: z.literal("coming_soon"),
  message: z.string(),
  projectionNames: z.array(z.string()),
  sampleSize: z.number(),
});
export interface OpsDryRunReplaySchema extends Named<typeof opsDryRunReplaySchemaDefinition> {}
export const opsDryRunReplaySchema: OpsDryRunReplaySchema = opsDryRunReplaySchemaDefinition;

/** The started run's id. The status query is what reports its progress. */
const opsReplayStartedSchemaDefinition = z.object({ runId: z.string() });
export interface OpsReplayStartedSchema extends Named<typeof opsReplayStartedSchemaDefinition> {}
export const opsReplayStartedSchema: OpsReplayStartedSchema = opsReplayStartedSchemaDefinition;
const opsReplayCancelledSchemaDefinition = z.object({ cancelled: z.boolean() });
export interface OpsReplayCancelledSchema extends Named<
  typeof opsReplayCancelledSchemaDefinition
> {}
export const opsReplayCancelledSchema: OpsReplayCancelledSchema =
  opsReplayCancelledSchemaDefinition;

/** Active tenant anomalies, hard tier first. */
const opsAnomalyListingSchemaDefinition = z.object({ anomalies: z.array(anomalySchema) });
export interface OpsAnomalyListingSchema extends Named<typeof opsAnomalyListingSchemaDefinition> {}
export const opsAnomalyListingSchema: OpsAnomalyListingSchema = opsAnomalyListingSchemaDefinition;
/** False when the anomaly had already cleared, which is not a failure. */
const opsAnomalyDismissedSchemaDefinition = z.object({ dismissed: z.boolean() });
export interface OpsAnomalyDismissedSchema extends Named<
  typeof opsAnomalyDismissedSchemaDefinition
> {}
export const opsAnomalyDismissedSchema: OpsAnomalyDismissedSchema =
  opsAnomalyDismissedSchemaDefinition;

// ---------------------------------------------------------------------------
// System migrations
// ---------------------------------------------------------------------------

const opsMigrationEnrolledSchemaDefinition = z.object({ enrolled: z.literal(true) });
export interface OpsMigrationEnrolledSchema extends Named<
  typeof opsMigrationEnrolledSchemaDefinition
> {}
export const opsMigrationEnrolledSchema: OpsMigrationEnrolledSchema =
  opsMigrationEnrolledSchemaDefinition;
const opsMigrationWithdrawnSchemaDefinition = z.object({ withdrawn: z.literal(true) });
export interface OpsMigrationWithdrawnSchema extends Named<
  typeof opsMigrationWithdrawnSchemaDefinition
> {}
export const opsMigrationWithdrawnSchema: OpsMigrationWithdrawnSchema =
  opsMigrationWithdrawnSchemaDefinition;
const opsMigrationPassStartedSchemaDefinition = z.object({ started: z.literal(true) });
export interface OpsMigrationPassStartedSchema extends Named<
  typeof opsMigrationPassStartedSchemaDefinition
> {}
export const opsMigrationPassStartedSchema: OpsMigrationPassStartedSchema =
  opsMigrationPassStartedSchemaDefinition;
const opsMigrationDrainAssertedSchemaDefinition = z.object({ asserted: z.literal(true) });
export interface OpsMigrationDrainAssertedSchema extends Named<
  typeof opsMigrationDrainAssertedSchemaDefinition
> {}
export const opsMigrationDrainAssertedSchema: OpsMigrationDrainAssertedSchema =
  opsMigrationDrainAssertedSchemaDefinition;
const opsMigrationRolledBackSchemaDefinition = z.object({ rolledBack: z.literal(true) });
export interface OpsMigrationRolledBackSchema extends Named<
  typeof opsMigrationRolledBackSchemaDefinition
> {}
export const opsMigrationRolledBackSchema: OpsMigrationRolledBackSchema =
  opsMigrationRolledBackSchemaDefinition;

// ---------------------------------------------------------------------------
// The operator-only ClickHouse EXPLAIN
// ---------------------------------------------------------------------------

/** The plans an operator may ask for. `ANALYZE` is absent: it would execute. */
export const opsExplainTypeSchema = z.enum(["PLAN", "SYNTAX", "PIPELINE", "AST", "INDEXES"]);
export type OpsExplainType = z.infer<typeof opsExplainTypeSchema>;

/** What the operator tool posts. */
const opsExplainRequestSchemaDefinition = z.object({
  query: z.string().trim().min(1, "query is required").max(50_000),
  type: opsExplainTypeSchema.optional(),
});
export interface OpsExplainRequestSchema extends Named<typeof opsExplainRequestSchemaDefinition> {}
export const opsExplainRequestSchema: OpsExplainRequestSchema = opsExplainRequestSchemaDefinition;
export type OpsExplainRequest = z.infer<typeof opsExplainRequestSchema>;

/**
 * What one EXPLAIN answers. `refused` is the guardrail pass, named so the
 * operator can fix it. `failed` deliberately carries no engine prose - the
 * cluster's own message names internals, so the service logs it instead.
 */
export type OpsExplainAnswer =
  | Readonly<{ status: "ok"; type: OpsExplainType; rows: unknown[] }>
  | Readonly<{ status: "refused"; reason: string }>
  | Readonly<{ status: "not_configured_in_production" }>
  | Readonly<{ status: "unavailable" }>
  | Readonly<{ status: "failed" }>;

/** A status a literal door answers with, in the codes its released callers read. */
export type OpsDoorStatus =
  | 200
  | 201
  | 400
  | 401
  | 403
  | 404
  | 409
  | 413
  | 422
  | 429
  | 500
  | 502
  | 503;

/** One literal door's answer: its status and the exact JSON body released callers parse. */
export type OpsDoorAnswer = Readonly<{
  status: OpsDoorStatus;
  body: Readonly<Record<string, unknown>>;
}>;
