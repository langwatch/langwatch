// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's own per-project usage (§9): one peer fold per owner pipeline (prompt, evaluator,
 * scenario, simulation run), a row per project each, and subscribers on trace's span_received and
 * trace_failed adding each trace and failed trace to its project's UTC day, one statement
 * a batch, while the organization is inside its counting window.
 * Evaluations add a day per project a day. Each change syncs the organization as one Customer.io
 * group call, mirrored onto each member whose latest organization it is (the emails read person
 * attributes; members from nurturing's own copy of the owners' member facts), placed by
 * nurturing's own copy of project and organization creation. It reads no other module's table and
 * calls no other module's API. Without a Customer.io channel only the copies register: nothing
 * reads the usage rows. Why event driven: https://github.com/langwatch/tasks/issues/1131.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { SSO_AUTO_ADDED_EVENT_TYPE, ssoAutoAddedEventDataSchema } from "@langwatch/auth-contract";
import {
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  evaluationLifecycleCompletedEventDataSchema,
} from "@langwatch/evaluation-contract";
import {
  EVALUATOR_CREATED_EVENT_TYPE,
  EVALUATOR_DELETED_EVENT_TYPE,
  evaluatorCreatedEventDataSchema,
  evaluatorDeletedEventDataSchema,
} from "@langwatch/evaluator-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type LaneAlias,
  type PeerEvent,
  type PeerBatchSubscriberDefinition,
  type PeerFoldProjectionDeclaration,
  type PeerFoldSubscriberSpec,
  type PeerMapProjectionDeclaration,
  type PeerSubscriberContext,
  type PeerSubscriberDefinition,
  throttledWindow,
} from "@langwatch/eventing";
import {
  GATEWAY_VK_LIFECYCLE_EVENT_TYPE,
  recordVkLifecycleCommandDataSchema,
} from "@langwatch/gateway-contract";
import {
  USER_ERASED_EVENT_TYPE as IDENTITY_USER_ERASED_EVENT_TYPE,
  userErasedPayloadSchema as identityUserErasedPayloadSchema,
} from "@langwatch/identity-contract";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  type OrganizationCreatedEventData,
  organizationCreatedEventDataSchema,
  organizationMemberDisabledEventDataSchema,
  organizationMemberEnabledEventDataSchema,
  organizationMemberListedEventDataSchema,
  organizationMemberRemovedEventDataSchema,
  organizationSignedUpEventDataSchema,
  PERSONAL_TEAM_CREATED_EVENT_TYPE,
  PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
  personalTeamCreatedEventDataSchema,
  personalWorkspaceProvisionedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE,
  PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
  type ProjectCreatedEventData,
  projectCreatedEventDataSchema,
  projectFirstMessageListedEventDataSchema,
  projectPersonalOwnerListedEventDataSchema,
} from "@langwatch/project-contract";
import {
  PROMPT_CREATED_EVENT_TYPE,
  PROMPT_DELETED_EVENT_TYPE,
  PROMPT_VERSION_SAVED_EVENT_TYPE,
  promptCreatedEventDataSchema,
  promptDeletedEventDataSchema,
  promptVersionSavedEventDataSchema,
} from "@langwatch/prompt-contract";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  SIMULATION_RUN_EVENT_TYPES,
  SIMULATION_SET_CREATED_EVENT_TYPE,
  scenarioCreatedEventDataSchema,
  simulationRunFinishedEventDataSchema,
  simulationSetCreatedEventDataSchema,
} from "@langwatch/scenario-contract";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  firstTraceRecordedEventDataSchema,
  LANGY_TRACE_ORIGIN,
  PROJECT_TRACED_EVENT_TYPE,
  projectTracedEventDataSchema,
  SPAN_RECEIVED_EVENT_TYPE,
  type SpanReceivedEventData,
  spanReceivedEventDataSchema,
  TRACE_FAILED_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
  traceFailedEventDataSchema,
  traceReceivedEventDataSchema,
} from "@langwatch/trace-contract";
import { USER_ERASED_EVENT_TYPE, userErasedEventDataSchema } from "@langwatch/user-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type { NurturingModule } from "../app/nurturing.app.ts";
import type { NurturingVirtualKeyRepository } from "../repositories/nurturing-gateway-key.repository.ts";
import type { NurturingOrganizationAdminRepository } from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import type {
  NurturingPersonalProjectRepository,
  NurturingPersonalProjectRow,
} from "../repositories/nurturing-personal-project.repository.ts";
import type { NurturingProjectPlacementRepository } from "../repositories/nurturing-project-placement.repository.ts";
import {
  NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
  type NurturingProjectUsageOwner,
  type NurturingProjectUsageRepository,
} from "../repositories/nurturing-project-usage.repository.ts";
import type {
  NurturingTracedProjectRepository,
  NurturingTracedProjectRow,
} from "../repositories/nurturing-traced-project.repository.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import type { NurturingMembershipChange } from "../rules/nurturing-organization-member.rules.ts";
import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageFact,
  type NurturingProjectUsageState,
} from "../rules/nurturing-project-usage.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";
import type { NurturingCountedTrace } from "../rules/nurturing-trace-day.rules.ts";
import {
  type NurturingVirtualKeyFact,
  virtualKeyFactOf,
} from "../rules/nurturing-virtual-key.rules.ts";
import { NURTURING_PIPELINE_NAME } from "./nurturing-signal.events.ts";

/** Hosts nurturing's peer folds and subscribers over the owners' facts; no event of its own. */
export const NURTURING_PROJECT_USAGE_PIPELINE_NAME = "nurturing_project_usage" as const;

/** A burst of a project's facts collapses into one group call per owner per this window. */
const USAGE_SYNC_DELAY_MS = 60_000;

/**
 * Traces sync an organization, one Customer.io group call, at most once per this window however
 * busy it is: the owner's choice of freshness for the trace traits over one call a day.
 */
export const TRACE_USAGE_SYNC_WINDOW_MS = 15 * 60_000;

/** A project's evaluations write its day once: later ones the same day would add nothing. */
const EVALUATION_DAY_DEDUP_TTL_MS = 24 * 60 * 60_000;

/**
 * Every fold here is keyed across many owner aggregates (a project): a re-fold loads one
 * aggregate's log, so it would rebuild the row from that one alone. Their applies commute (sets,
 * sums, maxima), so an event older than the row's newest is folded on as it comes.
 */
const KEYED_FOLD_OPTIONS = { refoldOnOutOfOrder: false } as const;

/** Each owner pipeline's facts, each parsed by its owner contract's own schema. */
export const nurturingProjectUsagePeerEvents = {
  prompt: [
    { type: PROMPT_CREATED_EVENT_TYPE, data: promptCreatedEventDataSchema },
    { type: PROMPT_VERSION_SAVED_EVENT_TYPE, data: promptVersionSavedEventDataSchema },
    { type: PROMPT_DELETED_EVENT_TYPE, data: promptDeletedEventDataSchema },
  ],
  evaluator: [
    { type: EVALUATOR_CREATED_EVENT_TYPE, data: evaluatorCreatedEventDataSchema },
    { type: EVALUATOR_DELETED_EVENT_TYPE, data: evaluatorDeletedEventDataSchema },
  ],
  scenario: [
    { type: SCENARIO_CREATED_EVENT_TYPE, data: scenarioCreatedEventDataSchema },
    { type: SIMULATION_SET_CREATED_EVENT_TYPE, data: simulationSetCreatedEventDataSchema },
  ],
  simulation: [
    { type: SIMULATION_RUN_EVENT_TYPES.FINISHED, data: simulationRunFinishedEventDataSchema },
  ],
} as const satisfies Record<NurturingProjectUsageOwner, readonly unknown[]>;

type AllPeerEvents = (typeof nurturingProjectUsagePeerEvents)[NurturingProjectUsageOwner];

/** Any owner fact a project-usage fold takes. */
export type NurturingProjectUsagePeerEvent = PeerEvent<AllPeerEvents>;

/** The project a fact is about: its data's project, else its tenant (a project here). */
export function projectIdOf(event: NurturingProjectUsagePeerEvent): string {
  return "projectId" in event.data && typeof event.data.projectId === "string"
    ? event.data.projectId
    : String(event.tenantId);
}

/** The owner fact as the fold counts it. */
export function projectUsageFactOf(
  event: NurturingProjectUsagePeerEvent,
): NurturingProjectUsageFact {
  const { occurredAt } = event;
  switch (event.type) {
    case PROMPT_CREATED_EVENT_TYPE:
      return { kind: "prompt_created", promptId: event.data.promptId, occurredAt };
    case PROMPT_VERSION_SAVED_EVENT_TYPE:
      return { kind: "prompt_version_saved", occurredAt };
    case PROMPT_DELETED_EVENT_TYPE:
      return { kind: "prompt_deleted", promptId: event.data.promptId, occurredAt };
    case EVALUATOR_CREATED_EVENT_TYPE:
      return { kind: "evaluator_created", evaluatorId: event.data.evaluatorId, occurredAt };
    case EVALUATOR_DELETED_EVENT_TYPE:
      return { kind: "evaluator_deleted", evaluatorId: event.data.evaluatorId, occurredAt };
    case SCENARIO_CREATED_EVENT_TYPE:
      return { kind: "scenario_created", scenarioCount: event.data.scenarioCount, occurredAt };
    case SIMULATION_SET_CREATED_EVENT_TYPE:
      return {
        kind: "simulation_set_created",
        scenarioSetId: event.data.scenarioSetId,
        occurredAt,
      };
    case SIMULATION_RUN_EVENT_TYPES.FINISHED:
      return { kind: "scenario_run", occurredAt };
  }
}

/** The throttle key of a trace fact: its organization, else (an older fact) its project. */
export function traceSyncKeyOf(event: Event): string {
  const { data } = event as Event<{ organizationId?: unknown }>;
  return typeof data?.organizationId === "string"
    ? `subscriber:traceUsageSync:organization:${data.organizationId}`
    : `subscriber:traceUsageSync:project:${String(event.tenantId)}`;
}

/** The project an evaluation is about: its data's project, else its tenant. */
function evaluationProjectIdOf(event: Event): string {
  const { data } = event as Event<{ projectId?: unknown }>;
  return typeof data?.projectId === "string" ? data.projectId : String(event.tenantId);
}

/** The dedup key of an evaluation: its project's UTC day, so each day writes once. */
export function evaluationDayKeyOf(event: Event): string {
  return `subscriber:evaluationActiveDay:${evaluationProjectIdOf(event)}:${utcDayOf(event.occurredAt)}`;
}

/** The queue group of an evaluation: its project, whose one evaluation row the days share. */
export function evaluationProjectGroupOf(event: Event): string {
  return `evaluationActiveDay:${evaluationProjectIdOf(event)}`;
}

/** One owner's peer fold, one row per project in its store; lane `<pipeline>.<owner>Usage`. */
export function nurturingProjectUsagePeerFold<Owner extends NurturingProjectUsageOwner>({
  owner,
  store,
}: Readonly<{
  owner: Owner;
  store: NurturingProjectUsageRepository;
}>): PeerFoldProjectionDeclaration<
  NurturingProjectUsageState,
  (typeof nurturingProjectUsagePeerEvents)[Owner]
> {
  const events = nurturingProjectUsagePeerEvents[owner];
  return {
    events,
    fold: {
      name: `${owner}Usage`,
      version: NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
      eventTypes: events.map(({ type }) => type),
      init: () => emptyProjectUsage(""),
      apply: (state, event) => {
        const parsed = event as NurturingProjectUsagePeerEvent;
        return foldProjectUsage(
          state.projectId === "" ? { ...state, projectId: projectIdOf(parsed) } : state,
          projectUsageFactOf(parsed),
        );
      },
      key: (event) => projectIdOf(event as NurturingProjectUsagePeerEvent),
      store: store.forOwner(owner),
      LastEventOccurredAtKey: "LastEventOccurredAt",
      options: KEYED_FOLD_OPTIONS,
    },
  };
}

/** The trace-level origin attribute, set on a span or (Langy's relay) on its resource. */
const ORIGIN_ATTRIBUTE = "langwatch.origin";

/** Origins trace keeps out of a project's first trace: onboarding samples and Langy's turns. */
const NON_CUSTOMER_ORIGINS: ReadonlySet<string> = new Set(["sample", LANGY_TRACE_ORIGIN]);

/**
 * An OTLP attribute as the origin read takes it: its key and string value. Lighter than the
 * contract's any-value parse, which the enqueue filter would otherwise run on every span appended.
 */
const originAttributesSchema = z
  .array(z.object({ key: z.string(), value: z.object({ stringValue: z.string().nullish() }) }))
  .optional();

function extractOrigin(attributes: z.output<typeof originAttributesSchema>): string | undefined {
  const origin = attributes?.find(({ key }) => key === ORIGIN_ATTRIBUTE)?.value.stringValue;
  return origin ? origin : undefined;
}

/** What the trace-day count reads of a span: whether it is a root, and its origin; no body. */
export type NurturingTraceSpanData = Readonly<{
  span: Pick<SpanReceivedEventData["span"], "parentSpanId">;
  /** The explicit origin, the span's own before its resource's, as trace hoists it. */
  origin?: string;
}>;

const traceSpanDataSchema = z
  .object({
    span: spanReceivedEventDataSchema.shape.span
      .pick({ parentSpanId: true })
      .extend({ attributes: originAttributesSchema }),
    resource: z.object({ attributes: originAttributesSchema }).nullish(),
  })
  .transform(({ span: { parentSpanId, attributes }, resource }): NurturingTraceSpanData => ({
    span: { parentSpanId },
    origin: extractOrigin(attributes) ?? extractOrigin(resource?.attributes),
  }));

/** Not a sample's or Langy's own trace, which trace's `isRealFirstIngest` leaves out too. */
function isCustomerOrigin(origin: string | undefined): boolean {
  return origin === undefined || !NON_CUSTOMER_ORIGINS.has(origin);
}

/** A root span: one per trace, the only span the trace-day count takes. */
export function isRootSpan(data: NurturingTraceSpanData): boolean {
  return !data.span.parentSpanId;
}

/** A customer's trace: its root span, unless a sample's or Langy's own turn. */
export function isCountedTrace(data: NurturingTraceSpanData): boolean {
  return isRootSpan(data) && isCustomerOrigin(data.origin);
}

/** A root span as its count takes it: its project (the tenant) and append day. */
export function countedTraceOf({
  context,
}: Readonly<{
  context: Pick<PeerSubscriberContext, "tenantId" | "createdAt">;
}>): NurturingCountedTrace {
  return {
    projectId: String(context.tenantId),
    kind: "trace",
    day: utcDayOf(context.createdAt),
    at: context.createdAt,
  };
}

/** What the trace and failure counts call: the app counts the traces inside their window. */
export type NurturingTraceCounting = Readonly<{
  countTraces: (input: Readonly<{ traces: readonly NurturingCountedTrace[] }>) => Promise<void>;
}>;

/** Most root spans of one project and day the queue drains into one batch, one upsert. */
const TRACE_DAY_COALESCE_MAX_BATCH = 500;

/** The queue group of a span: its project and UTC day, the row its count lands on. */
export function traceDayGroupOf(event: Event): string {
  return JSON.stringify([String(event.tenantId), utcDayOf(event.createdAt)]);
}

/**
 * One project's traces per UTC day: root spans of one project and day are coalesced, and each
 * batch adds its traces in one Postgres statement. Nothing de-duplicates: a redelivered batch
 * counts a trace again, and so does a root span stored more than once (a re-emitted
 * span_received), accepted (issue 9378). Only organizations in their counting window count. Not a
 * fold, so no replay rebuilds the rows. Child, sample and Langy spans mint no job; the handler
 * drops any staged.
 */
export function nurturingTraceDaySubscriber({
  countTraces,
}: NurturingTraceCounting): PeerBatchSubscriberDefinition<typeof traceSpanDataSchema> {
  return {
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    data: traceSpanDataSchema,
    options: {
      enqueue: { filter: isCountedTrace },
      groupKeyFn: traceDayGroupOf,
      coalesceMaxBatch: TRACE_DAY_COALESCE_MAX_BATCH,
    },
    handleBatch: (items) =>
      countTraces({
        traces: items
          .filter(({ data }) => isCountedTrace(data))
          .map(({ context }) => countedTraceOf({ context })),
      }),
  };
}

/** What the failed-trace count reads of trace_failed: its project and origin. */
const failedTraceDataSchema = traceFailedEventDataSchema.pick({
  projectId: true,
  origin: true,
});

/**
 * One project's failed traces per UTC day: errorCount counts trace's trace_failed facts on the
 * day each was appended. Like the trace count, a redelivered or re-stored fact counts again
 * (owner decision, issue 9378). Sample and Langy failures mint no job; the handler drops any
 * staged.
 */
export function nurturingFailedTraceDaySubscriber({
  countTraces,
}: NurturingTraceCounting): PeerBatchSubscriberDefinition<typeof failedTraceDataSchema> {
  return {
    eventType: TRACE_FAILED_EVENT_TYPE,
    data: failedTraceDataSchema,
    options: {
      enqueue: { filter: ({ origin }) => isCustomerOrigin(origin) },
      groupKeyFn: traceDayGroupOf,
      coalesceMaxBatch: TRACE_DAY_COALESCE_MAX_BATCH,
    },
    handleBatch: (items) =>
      countTraces({
        traces: items
          .filter(({ data }) => isCustomerOrigin(data.origin))
          .map(({ data, context }) => ({
            projectId: data.projectId,
            kind: "failed" as const,
            day: utcDayOf(context.createdAt),
            at: context.createdAt,
          })),
      }),
  };
}

type UsageChanged = (input: Readonly<{ projectId: string }>) => Promise<void>;

/**
 * Each fold's subscriber: throttled per project, so a burst of one owner's facts sends once, a
 * minute after its first fact; a steady stream cannot push the send back. The framework keeps
 * each subscriber's dedup to its own lane, so several owners' facts send once per owner; each
 * send is the organization's whole sum, so a repeat is harmless.
 */
export function organizationUsageSubscriber(
  usageChanged: UsageChanged,
): PeerFoldSubscriberSpec<NurturingProjectUsageState> {
  return {
    name: "organizationUsage",
    ...throttledWindow<Event>({
      makeId: (event) => `project:${projectIdOf(event as NurturingProjectUsagePeerEvent)}`,
      windowMs: USAGE_SYNC_DELAY_MS,
    }),
    handler: (_event, { state }) => usageChanged({ projectId: state.projectId }),
  };
}

/** What the first-trace sync reads of first_trace_recorded: its project, the throttle key. */
const firstTraceSyncDataSchema = firstTraceRecordedEventDataSchema.pick({ projectId: true });

/** What the trace sync reads of trace_received; its throttle reads the organization. */
const traceSyncDataSchema = traceReceivedEventDataSchema.pick({ projectId: true });

/**
 * The trace syncs, throttled per organization: trace records a project's first real trace as
 * first_trace_recorded and only later ones as trace_received, so both sync. Each only reads the
 * counts its root span added, so the first trace is counted once. The queue squashes a dedup id
 * only inside one group, and a job's group defaults to its trace, so the throttle key is the
 * group too; the queue still prefixes each group with its project.
 */
export function nurturingTraceUsageSyncSubscribers(tracesChanged: UsageChanged): Readonly<{
  firstTrace: PeerSubscriberDefinition<typeof firstTraceSyncDataSchema>;
  laterTrace: PeerSubscriberDefinition<typeof traceSyncDataSchema>;
}> {
  const { delay, dedup } = throttledWindow<Event>({
    makeId: traceSyncKeyOf,
    windowMs: TRACE_USAGE_SYNC_WINDOW_MS,
  });
  const options = { delay, deduplication: dedup, groupKeyFn: traceSyncKeyOf };
  return {
    firstTrace: {
      eventType: FIRST_TRACE_RECORDED_EVENT_TYPE,
      data: firstTraceSyncDataSchema,
      options,
      handle: ({ projectId }) => tracesChanged({ projectId }),
    },
    laterTrace: {
      eventType: TRACE_RECEIVED_EVENT_TYPE,
      data: traceSyncDataSchema,
      options,
      handle: ({ projectId }) => tracesChanged({ projectId }),
    },
  };
}

/**
 * Evaluations add their UTC day to the project's evaluation row, once a day; no sync of their
 * own, the next one reads the days. One lane per project, since the row is read, then written.
 */
export function nurturingEvaluationDaySubscriber(
  store: NurturingProjectUsageRepository,
): PeerSubscriberDefinition<typeof evaluationLifecycleCompletedEventDataSchema> {
  return {
    eventType: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
    data: evaluationLifecycleCompletedEventDataSchema,
    options: {
      groupKeyFn: evaluationProjectGroupOf,
      deduplication: {
        makeId: evaluationDayKeyOf,
        ttlMs: EVALUATION_DAY_DEDUP_TTL_MS,
        extend: false,
        replace: false,
        shouldSurviveDispatch: true,
      },
    },
    handle: ({ projectId, occurredAt }) => store.recordEvaluationDay({ projectId, occurredAt }),
  };
}

/** Nurturing's own copies of owner facts, kept whether or not a channel syncs. */
export type NurturingUsageCopies = Readonly<{
  placements: NurturingProjectPlacementRepository;
  /** A project's placement copy was written: it is no longer uncopied. */
  copyLanded: (input: Readonly<{ projectId: string }>) => Promise<void>;
  organizationsCreated: NurturingOrganizationCreatedRepository;
  /** Each organization's admin and seeded flag, folded from project's created facts. */
  admins: Pick<NurturingOrganizationAdminRepository, "recordAdminFact">;
  members: NurturingOrganizationMemberRepository;
  virtualKeys: NurturingVirtualKeyRepository;
  personalProjects: NurturingPersonalProjectRepository;
  tracedProjects: NurturingTracedProjectRepository;
}>;

/** What the usage sync needs; absent without a Customer.io channel, when nothing syncs. */
export type NurturingUsageSync = NurturingTraceCounting &
  Readonly<{
    usageChanged: UsageChanged;
    /** A trace's sync: the organization's, unless its counting window has ended. */
    tracesChanged: UsageChanged;
    /** Names a new organization in Customer.io on its founder. */
    organizationCreated: (data: OrganizationCreatedEventData) => Promise<void>;
  }>;

function nurturingProjectUsageHost({
  store,
  copies,
  sync,
  logger = createLogger("langwatch:nurturing:project-facts"),
}: Readonly<{
  store: NurturingProjectUsageRepository;
  copies: NurturingUsageCopies;
  sync: NurturingUsageSync | undefined;
  /** Where a traced fact naming no organization is logged. */
  logger?: ProjectFactsLogger;
}>) {
  const { organizationsCreated, admins, members, virtualKeys, personalProjects, tracedProjects } =
    copies;
  // The copies always register, as nurturing's other copies do: a channel configured later
  // then finds the projects, organizations, members and gateway keys created before it.
  const copied = definePipeline({
    name: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "nurturing_project_usage_view" }),
  })
    .withEvents([])
    // Registered whether or not a channel syncs. The marks lane is the key lane's replay
    // prerequisite (the withMigrations steps in nurturing.module.ts).
    .withPeerMapProjection(nurturingUserErasureMarksMap(virtualKeys))
    .withPeerMapProjection(nurturingIdentityErasureMarksMap(virtualKeys))
    .withPeerMapProjection(nurturingVirtualKeysMap(virtualKeys))
    .withPeerMapProjection(nurturingProjectPlacementsMap(copies))
    .withPeerMapProjection(nurturingOrganizationCreationsMap(organizationsCreated))
    .withPeerMapProjection(nurturingOrganizationAdminsMap(admins))
    .withPeerMapProjection(nurturingOrganizationMembersMap(members))
    .withPeerMapProjection(nurturingAuthMembersMap(members))
    .withPeerMapProjection(nurturingPersonalOwnersOfOrganizationMap(personalProjects))
    .withPeerMapProjection(nurturingPersonalOwnersOfProjectMap(personalProjects))
    .withPeerMapProjection(nurturingTracedProjectsOfTraceMap({ tracedProjects, logger }))
    .withPeerMapProjection(nurturingTracedProjectsOfProjectMap({ tracedProjects, logger }))
    .withLaneAliases([
      ...ORGANIZATION_COPY_LANE_ALIASES,
      ...PERSONAL_AND_TRACED_PROJECT_LANE_ALIASES,
    ]);
  // Without a channel no sync reads the usage rows, and none prunes the trace days, so none is kept.
  if (!sync) return copied;
  const { usageChanged, tracesChanged, organizationCreated } = sync;
  const subscribers = [organizationUsageSubscriber(usageChanged)];
  const traceSyncs = nurturingTraceUsageSyncSubscribers(tracesChanged);
  return (
    copied
      .withPeerFoldProjection(
        nurturingProjectUsagePeerFold({ owner: "prompt", store }),
        subscribers,
      )
      .withPeerFoldProjection(
        nurturingProjectUsagePeerFold({ owner: "evaluator", store }),
        subscribers,
      )
      .withPeerFoldProjection(
        nurturingProjectUsagePeerFold({ owner: "scenario", store }),
        subscribers,
      )
      .withPeerFoldProjection(
        nurturingProjectUsagePeerFold({ owner: "simulation", store }),
        subscribers,
      )
      .withPeerSubscriber("traceDayCount", nurturingTraceDaySubscriber(sync))
      .withPeerSubscriber("failedTraceDayCount", nurturingFailedTraceDaySubscriber(sync))
      // Throttled, not debounced: an organization tracing without pause still syncs once per
      // window, 15 minutes after the window's first trace, when its root spans are counted.
      .withPeerSubscriber("firstTraceUsageSync", traceSyncs.firstTrace)
      .withPeerSubscriber("traceUsageSync", traceSyncs.laterTrace)
      .withPeerSubscriber("evaluationActiveDay", nurturingEvaluationDaySubscriber(store))
      .withPeerSubscriber("organizationCreatedSync", {
        eventType: ORGANIZATION_CREATED_EVENT_TYPE,
        data: organizationCreatedEventDataSchema,
        handle: (data) => organizationCreated(data),
      })
  );
}

/** Lane names under `<host pipeline>.`, which the withMigrations steps in nurturing.module.ts name. */
export const NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME = "userErasureMarks" as const;
export const NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME = "identityErasureMarks" as const;
export const NURTURING_VIRTUAL_KEYS_PROJECTION_NAME = "virtualKeys" as const;

type ErasureMark = Readonly<{ userId: string }>;

const USER_ERASURE_EVENTS = [
  { type: USER_ERASED_EVENT_TYPE, data: userErasedEventDataSchema },
] as const;
const IDENTITY_ERASURE_EVENTS = [
  { type: IDENTITY_USER_ERASED_EVENT_TYPE, data: identityUserErasedPayloadSchema },
] as const;

/**
 * Marks the account and clears it from the key copies, nothing more: a marks step run after the
 * key step still leaves no erased person on a key. The other copies' clearing stays on the live
 * "userErased" lane.
 */
const markStore = (virtualKeys: Pick<NurturingVirtualKeyRepository, "forgetUser">) => ({
  append: ({ userId }: ErasureMark) => virtualKeys.forgetUser({ userId }),
});

/**
 * Nurturing's erasure marks from user's erasure facts (§9). One lane a source: a peer projection
 * takes the events of one owner pipeline. Its replay step runs before the key copy's, so a key
 * copied from old facts never stores a person erased before nurturing kept marks.
 */
export function nurturingUserErasureMarksMap(
  virtualKeys: Pick<NurturingVirtualKeyRepository, "forgetUser">,
): PeerMapProjectionDeclaration<ErasureMark, typeof USER_ERASURE_EVENTS> {
  return {
    events: USER_ERASURE_EVENTS,
    map: {
      name: NURTURING_USER_ERASURE_MARKS_PROJECTION_NAME,
      eventTypes: [USER_ERASED_EVENT_TYPE],
      map: ({ data: { userId } }) => ({ userId }),
      store: markStore(virtualKeys),
    },
  };
}

/** The same marks from identity's erasure fact, which names the same account (see above). */
export function nurturingIdentityErasureMarksMap(
  virtualKeys: Pick<NurturingVirtualKeyRepository, "forgetUser">,
): PeerMapProjectionDeclaration<ErasureMark, typeof IDENTITY_ERASURE_EVENTS> {
  return {
    events: IDENTITY_ERASURE_EVENTS,
    map: {
      name: NURTURING_IDENTITY_ERASURE_MARKS_PROJECTION_NAME,
      eventTypes: [IDENTITY_USER_ERASED_EVENT_TYPE],
      map: ({ data: { userId } }) => ({ userId }),
      store: markStore(virtualKeys),
    },
  };
}

const VIRTUAL_KEY_EVENTS = [
  { type: GATEWAY_VK_LIFECYCLE_EVENT_TYPE, data: recordVkLifecycleCommandDataSchema },
] as const;

/**
 * Nurturing's own copy of a gateway key, from each of gateway's lifecycle facts (§9): its
 * organization, name, creator, holder, purpose and state. One statement a fact, never a batch
 * (no `bulkAppend`): the copy's equal-stamp tie-break and erasure check read the row each fact
 * meets, so live and replay fold alike. Every column folds order-free, so a redelivered or late
 * fact changes nothing.
 */
export function nurturingVirtualKeysMap(
  virtualKeys: Pick<NurturingVirtualKeyRepository, "recordKeyFact">,
): PeerMapProjectionDeclaration<NurturingVirtualKeyFact, typeof VIRTUAL_KEY_EVENTS> {
  return {
    events: VIRTUAL_KEY_EVENTS,
    map: {
      name: NURTURING_VIRTUAL_KEYS_PROJECTION_NAME,
      eventTypes: [GATEWAY_VK_LIFECYCLE_EVENT_TYPE],
      map: ({ data }) => virtualKeyFactOf(data),
      store: { append: (fact) => virtualKeys.recordKeyFact({ fact }) },
    },
  };
}

export const NURTURING_PROJECT_PLACEMENTS_PROJECTION_NAME = "projectPlacements" as const;
export const NURTURING_ORGANIZATION_CREATIONS_PROJECTION_NAME = "organizationCreations" as const;
export const NURTURING_ORGANIZATION_ADMINS_PROJECTION_NAME = "organizationAdmins" as const;
export const NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME = "organizationMembers" as const;
export const NURTURING_AUTH_MEMBERS_PROJECTION_NAME = "authMembers" as const;

/** A retired peer subscriber's queue key, as the previous release queued its jobs. */
const retiredPeerSubscriberKey = (pipeline: string, lane: string) =>
  `global:subscriber:${pipeline}.${lane}`;

/** This pipeline's peer map lane that takes a retired lane's jobs. */
const toPeerMap = (lane: string) => ({ jobType: "handler", lane }) as const;

/**
 * The organization-side copy subscribers these maps replaced. A job the previous release queued
 * under one reaches its successor map, which writes the same row the subscriber would have: every
 * write here is order-free and idempotent, so the job may also have been replayed.
 */
export const ORGANIZATION_COPY_LANE_ALIASES: readonly LaneAlias[] = [
  {
    from: retiredPeerSubscriberKey(NURTURING_PROJECT_USAGE_PIPELINE_NAME, "projectPlacement"),
    to: toPeerMap(NURTURING_PROJECT_PLACEMENTS_PROJECTION_NAME),
  },
  {
    from: retiredPeerSubscriberKey(NURTURING_PROJECT_USAGE_PIPELINE_NAME, "organizationCreated"),
    to: toPeerMap(NURTURING_ORGANIZATION_CREATIONS_PROJECTION_NAME),
  },
  {
    from: retiredPeerSubscriberKey(NURTURING_PIPELINE_NAME, "projectCreated"),
    to: toPeerMap(NURTURING_ORGANIZATION_ADMINS_PROJECTION_NAME),
  },
  ...[
    "memberFoundedOrganization",
    "memberSignedUp",
    "memberInviteAccepted",
    "memberRemoved",
    "memberDisabled",
    "memberEnabled",
  ].map((lane) => ({
    from: retiredPeerSubscriberKey(NURTURING_PROJECT_USAGE_PIPELINE_NAME, lane),
    to: toPeerMap(NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME),
  })),
  {
    from: retiredPeerSubscriberKey(NURTURING_PROJECT_USAGE_PIPELINE_NAME, "memberSsoAutoAdded"),
    to: toPeerMap(NURTURING_AUTH_MEMBERS_PROJECTION_NAME),
  },
];

const PROJECT_CREATED_EVENTS = [
  { type: PROJECT_CREATED_EVENT_TYPE, data: projectCreatedEventDataSchema },
] as const;

const ORGANIZATION_CREATED_EVENTS = [
  { type: ORGANIZATION_CREATED_EVENT_TYPE, data: organizationCreatedEventDataSchema },
] as const;

type NurturingPlacementFact = Readonly<{ projectId: string; organizationId: string }>;

/**
 * Nurturing's own copy of a project's organization, from project's creation fact (§9). A move
 * stays within the organization and an archived project stays counted, so only creation writes.
 * The upsert is order-free, so its deploy replay fills projects created before the copy existed.
 */
export function nurturingProjectPlacementsMap({
  placements,
  copyLanded,
}: Readonly<{
  placements: Pick<NurturingProjectPlacementRepository, "recordProject">;
  copyLanded: NurturingUsageCopies["copyLanded"];
}>): PeerMapProjectionDeclaration<NurturingPlacementFact, typeof PROJECT_CREATED_EVENTS> {
  return {
    events: PROJECT_CREATED_EVENTS,
    map: {
      name: NURTURING_PROJECT_PLACEMENTS_PROJECTION_NAME,
      eventTypes: [PROJECT_CREATED_EVENT_TYPE],
      map: ({ data: { projectId, organizationId } }) => ({ projectId, organizationId }),
      store: {
        // The copy first: a forget that fails retries the fact, and the write repeats harmlessly.
        append: async (placement) => {
          await placements.recordProject(placement);
          await copyLanded({ projectId: placement.projectId });
        },
      },
    },
  };
}

type NurturingOrganizationCreation = Readonly<{ organizationId: string; createdAt: number }>;

/**
 * Nurturing's own copy of an organization's creation, the signup day of its usage traits. The
 * earliest time is kept, so a redelivered, late or replayed fact changes nothing.
 */
export function nurturingOrganizationCreationsMap(
  organizationsCreated: Pick<NurturingOrganizationCreatedRepository, "recordOrganizationCreated">,
): PeerMapProjectionDeclaration<NurturingOrganizationCreation, typeof ORGANIZATION_CREATED_EVENTS> {
  return {
    events: ORGANIZATION_CREATED_EVENTS,
    map: {
      name: NURTURING_ORGANIZATION_CREATIONS_PROJECTION_NAME,
      eventTypes: [ORGANIZATION_CREATED_EVENT_TYPE],
      map: ({ data: { organizationId, occurredAt } }) => ({
        organizationId,
        createdAt: occurredAt,
      }),
      store: { append: (created) => organizationsCreated.recordOrganizationCreated(created) },
    },
  };
}

/** One project-created fact as the organization's admin row folds it. */
export type NurturingAdminFact = Parameters<
  NurturingOrganizationAdminRepository["recordAdminFact"]
>[0];

/**
 * Project's created fact as its organization's row takes it: the admin it names at its stamp, and
 * seeded when project's backfill recorded it (the organization's first milestones already
 * happened).
 */
export function organizationAdminFactOf(data: ProjectCreatedEventData): NurturingAdminFact {
  return {
    organizationId: data.organizationId,
    adminUserId: data.adminUserId ?? null,
    at: data.occurredAt,
    seeded: data.backfilled === true,
  };
}

/**
 * Nurturing's own organization row, admin and seeded flag, from project's created facts (§9). One
 * statement a fact, never a batch (no `bulkAppend`): the write's erasure check and re-check read
 * the marks each fact meets. The admin is the latest-stamped one and `seeded` only turns on, so a
 * redelivered, late or replayed fact leaves the row as live delivery would.
 */
export function nurturingOrganizationAdminsMap(
  admins: Pick<NurturingOrganizationAdminRepository, "recordAdminFact">,
): PeerMapProjectionDeclaration<NurturingAdminFact, typeof PROJECT_CREATED_EVENTS> {
  return {
    events: PROJECT_CREATED_EVENTS,
    map: {
      name: NURTURING_ORGANIZATION_ADMINS_PROJECTION_NAME,
      eventTypes: [PROJECT_CREATED_EVENT_TYPE],
      map: ({ data }) => organizationAdminFactOf(data),
      store: { append: (fact) => admins.recordAdminFact(fact) },
    },
  };
}

const ORGANIZATION_MEMBER_EVENTS = [
  { type: ORGANIZATION_CREATED_EVENT_TYPE, data: organizationCreatedEventDataSchema },
  { type: ORGANIZATION_SIGNED_UP_EVENT_TYPE, data: organizationSignedUpEventDataSchema },
  { type: INVITE_ACCEPTED_EVENT_TYPE, data: inviteAcceptedEventDataSchema },
  { type: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE, data: organizationMemberRemovedEventDataSchema },
  {
    type: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
    data: organizationMemberDisabledEventDataSchema,
  },
  { type: ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE, data: organizationMemberEnabledEventDataSchema },
  { type: ORGANIZATION_MEMBER_LISTED_EVENT_TYPE, data: organizationMemberListedEventDataSchema },
] as const;

const AUTH_MEMBER_EVENTS = [
  { type: SSO_AUTO_ADDED_EVENT_TYPE, data: ssoAutoAddedEventDataSchema },
] as const;

/** One owner member fact as nurturing's member copy keeps it: a join, a leave or a return. */
export type NurturingMembershipFact = Readonly<{
  organizationId: string;
  userId: string;
  change: NurturingMembershipChange;
  at: number;
}>;

/**
 * Organization's member fact as the copy keeps it, at the fact's time. A creation joins its
 * founder, since an organization created for an existing user (`createAndAssign`) records no
 * signup; a provisioned one names no founder and keeps nothing. A listed member joined when
 * organization's membership row was created.
 */
export function organizationMembershipFactOf(
  event: PeerEvent<typeof ORGANIZATION_MEMBER_EVENTS>,
): NurturingMembershipFact | null {
  const { organizationId, occurredAt } = event.data;
  switch (event.type) {
    case ORGANIZATION_CREATED_EVENT_TYPE: {
      const { userId } = event.data;
      return userId ? { organizationId, userId, change: "joined", at: occurredAt } : null;
    }
    case ORGANIZATION_SIGNED_UP_EVENT_TYPE:
    case INVITE_ACCEPTED_EVENT_TYPE:
      return { organizationId, userId: event.data.userId, change: "joined", at: occurredAt };
    case ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE:
    case ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE:
      return { organizationId, userId: event.data.userId, change: "left", at: occurredAt };
    case ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE:
      return { organizationId, userId: event.data.userId, change: "returned", at: occurredAt };
    case ORGANIZATION_MEMBER_LISTED_EVENT_TYPE:
      return {
        organizationId,
        userId: event.data.userId,
        change: "joined",
        at: event.data.joinedAt,
      };
  }
}

/**
 * The member copy's store: one statement a fact, never a batch (no `bulkAppend`), since the
 * write's erasure check and re-check read the marks each fact meets. Each change keeps its latest
 * time, so a redelivered, late or replayed fact leaves the row as live delivery would.
 */
const memberStore = (
  members: Pick<NurturingOrganizationMemberRepository, "recordMembershipChange">,
) => ({ append: (fact: NurturingMembershipFact) => members.recordMembershipChange(fact) });

/**
 * Nurturing's own copy of who belongs to which organization, from organization's member facts
 * (§9), including the members organization's own step listed from before it recorded them.
 */
export function nurturingOrganizationMembersMap(
  members: Pick<NurturingOrganizationMemberRepository, "recordMembershipChange">,
): PeerMapProjectionDeclaration<NurturingMembershipFact, typeof ORGANIZATION_MEMBER_EVENTS> {
  return {
    events: ORGANIZATION_MEMBER_EVENTS,
    map: {
      name: NURTURING_ORGANIZATION_MEMBERS_PROJECTION_NAME,
      eventTypes: ORGANIZATION_MEMBER_EVENTS.map(({ type }) => type),
      map: organizationMembershipFactOf,
      store: memberStore(members),
    },
  };
}

/** The same copy from auth's single sign-on joins: one peer projection per owner pipeline. */
export function nurturingAuthMembersMap(
  members: Pick<NurturingOrganizationMemberRepository, "recordMembershipChange">,
): PeerMapProjectionDeclaration<NurturingMembershipFact, typeof AUTH_MEMBER_EVENTS> {
  return {
    events: AUTH_MEMBER_EVENTS,
    map: {
      name: NURTURING_AUTH_MEMBERS_PROJECTION_NAME,
      eventTypes: [SSO_AUTO_ADDED_EVENT_TYPE],
      map: ({ data: { organizationId, userId, occurredAt } }) => ({
        organizationId,
        userId,
        change: "joined",
        at: occurredAt,
      }),
      store: memberStore(members),
    },
  };
}

/** Where a map's refusal to keep a fact is logged. */
export type ProjectFactsLogger = Readonly<{
  warn(payload: Readonly<Record<string, unknown>>, message: string): void;
}>;

export const NURTURING_PERSONAL_OWNERS_OF_ORGANIZATION_PROJECTION_NAME =
  "personalOwnersOfOrganization" as const;
export const NURTURING_PERSONAL_OWNERS_OF_PROJECT_PROJECTION_NAME =
  "personalOwnersOfProject" as const;
export const NURTURING_TRACED_PROJECTS_OF_TRACE_PROJECTION_NAME =
  "tracedProjectsOfTrace" as const;
export const NURTURING_TRACED_PROJECTS_OF_PROJECT_PROJECTION_NAME =
  "tracedProjectsOfProject" as const;

/**
 * The five peer subscriber lanes these maps replace, on the `nurturing` pipeline. A job the
 * previous release queued under one reaches its successor map, which records the same fact.
 */
export const PERSONAL_AND_TRACED_PROJECT_LANE_ALIASES: readonly LaneAlias[] = [
  {
    from: "global:subscriber:nurturing.personalTeamCreated",
    to: {
      jobType: "handler",
      lane: NURTURING_PERSONAL_OWNERS_OF_ORGANIZATION_PROJECTION_NAME,
    },
  },
  {
    from: "global:subscriber:nurturing.personalWorkspaceProvisioned",
    to: {
      jobType: "handler",
      lane: NURTURING_PERSONAL_OWNERS_OF_ORGANIZATION_PROJECTION_NAME,
    },
  },
  {
    from: "global:subscriber:nurturing.personalOwnerListed",
    to: { jobType: "handler", lane: NURTURING_PERSONAL_OWNERS_OF_PROJECT_PROJECTION_NAME },
  },
  {
    from: "global:subscriber:nurturing.projectTraced",
    to: { jobType: "handler", lane: NURTURING_TRACED_PROJECTS_OF_TRACE_PROJECTION_NAME },
  },
  {
    from: "global:subscriber:nurturing.firstMessageListed",
    to: { jobType: "handler", lane: NURTURING_TRACED_PROJECTS_OF_PROJECT_PROJECTION_NAME },
  },
];

const PERSONAL_OWNER_OF_ORGANIZATION_EVENTS = [
  { type: PERSONAL_TEAM_CREATED_EVENT_TYPE, data: personalTeamCreatedEventDataSchema },
  {
    type: PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE,
    data: personalWorkspaceProvisionedEventDataSchema,
  },
] as const;

const PERSONAL_OWNER_OF_PROJECT_EVENTS = [
  {
    type: PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE,
    data: projectPersonalOwnerListedEventDataSchema,
  },
] as const;

/**
 * Nurturing's copy of a personal project's owner from organization's personal-workspace facts. The
 * first owner stays and an erased one is never stored, both in the store's own write, so a
 * redelivered, late or replayed fact leaves the row as live delivery would.
 */
export function nurturingPersonalOwnersOfOrganizationMap(
  personalProjects: Pick<NurturingPersonalProjectRepository, "recordOwner">,
): PeerMapProjectionDeclaration<
  NurturingPersonalProjectRow,
  typeof PERSONAL_OWNER_OF_ORGANIZATION_EVENTS
> {
  return {
    events: PERSONAL_OWNER_OF_ORGANIZATION_EVENTS,
    map: {
      name: NURTURING_PERSONAL_OWNERS_OF_ORGANIZATION_PROJECTION_NAME,
      eventTypes: PERSONAL_OWNER_OF_ORGANIZATION_EVENTS.map(({ type }) => type),
      map: ({ data: { projectId, organizationId, userId } }) => ({
        projectId,
        organizationId,
        ownerUserId: userId,
      }),
      store: { append: (row) => personalProjects.recordOwner(row) },
    },
  };
}

/** The same copy from project's listed owners of the personal projects it stored. */
export function nurturingPersonalOwnersOfProjectMap(
  personalProjects: Pick<NurturingPersonalProjectRepository, "recordOwner">,
): PeerMapProjectionDeclaration<
  NurturingPersonalProjectRow,
  typeof PERSONAL_OWNER_OF_PROJECT_EVENTS
> {
  return {
    events: PERSONAL_OWNER_OF_PROJECT_EVENTS,
    map: {
      name: NURTURING_PERSONAL_OWNERS_OF_PROJECT_PROJECTION_NAME,
      eventTypes: [PROJECT_PERSONAL_OWNER_LISTED_EVENT_TYPE],
      map: ({ data: { projectId, organizationId, ownerUserId } }) => ({
        projectId,
        organizationId,
        ownerUserId,
      }),
      store: { append: (row) => personalProjects.recordOwner(row) },
    },
  };
}

const TRACED_PROJECT_OF_TRACE_EVENTS = [
  { type: PROJECT_TRACED_EVENT_TYPE, data: projectTracedEventDataSchema },
] as const;

const TRACED_PROJECT_OF_PROJECT_EVENTS = [
  { type: PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE, data: projectFirstMessageListedEventDataSchema },
] as const;

/**
 * A project with no organization has nothing to count against, so it is logged and mapped to no
 * row.
 */
function tracedProjectOf({
  data: { projectId, organizationId },
  logger,
}: Readonly<{
  data: Readonly<{ projectId: string; organizationId: string | null }>;
  logger: ProjectFactsLogger;
}>): NurturingTracedProjectRow | null {
  if (organizationId === null) {
    logger.warn(
      { projectId },
      "a traced project names no organization; nurturing keeps no traced row for it",
    );
    return null;
  }
  return { projectId, organizationId };
}

/** Nurturing's copy of the projects that traced, from trace's `project_traced` fact; insert-ignore. */
export function nurturingTracedProjectsOfTraceMap({
  tracedProjects,
  logger,
}: Readonly<{
  tracedProjects: Pick<NurturingTracedProjectRepository, "recordTraced">;
  logger: ProjectFactsLogger;
}>): PeerMapProjectionDeclaration<
  NurturingTracedProjectRow,
  typeof TRACED_PROJECT_OF_TRACE_EVENTS
> {
  return {
    events: TRACED_PROJECT_OF_TRACE_EVENTS,
    map: {
      name: NURTURING_TRACED_PROJECTS_OF_TRACE_PROJECTION_NAME,
      eventTypes: [PROJECT_TRACED_EVENT_TYPE],
      map: ({ data }) => tracedProjectOf({ data, logger }),
      store: { append: (row) => tracedProjects.recordTraced(row) },
    },
  };
}

/** The same copy from project's listed first messages of the projects it stored. */
export function nurturingTracedProjectsOfProjectMap({
  tracedProjects,
  logger,
}: Readonly<{
  tracedProjects: Pick<NurturingTracedProjectRepository, "recordTraced">;
  logger: ProjectFactsLogger;
}>): PeerMapProjectionDeclaration<
  NurturingTracedProjectRow,
  typeof TRACED_PROJECT_OF_PROJECT_EVENTS
> {
  return {
    events: TRACED_PROJECT_OF_PROJECT_EVENTS,
    map: {
      name: NURTURING_TRACED_PROJECTS_OF_PROJECT_PROJECTION_NAME,
      eventTypes: [PROJECT_FIRST_MESSAGE_LISTED_EVENT_TYPE],
      map: ({ data }) => tracedProjectOf({ data, logger }),
      store: { append: (row) => tracedProjects.recordTraced(row) },
    },
  };
}

/** The host pipeline as a TYPE, derived from the builder above. */
export type NurturingProjectUsagePipeline = ReturnType<
  ReturnType<typeof nurturingProjectUsageHost>["build"]
>;

export function buildNurturingProjectUsagePipeline(
  deps: Parameters<typeof nurturingProjectUsageHost>[0],
): NurturingProjectUsagePipeline {
  return nurturingProjectUsageHost(deps).build();
}

export const nurturingProjectUsageEventing = defineEventingModule({
  pipeline: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  build: ({ repositories, app }: EventingSetup<NurturingRepositories, NurturingModule>) =>
    buildNurturingProjectUsagePipeline({
      store: repositories.projectUsage,
      copies: {
        placements: repositories.placements,
        copyLanded: (input) => app.uncopiedProjectCopied(input),
        organizationsCreated: repositories.organizationsCreated,
        admins: repositories.milestones,
        members: repositories.members,
        virtualKeys: repositories.virtualKeys,
        personalProjects: repositories.personalProjects,
        tracedProjects: repositories.tracedProjects,
      },
      sync: app.syncsOrganizationUsage()
        ? {
            countTraces: (input) => app.countTraces(input),
            usageChanged: (input) => app.organizationUsageChanged(input),
            tracesChanged: (input) => app.organizationTracesChanged(input),
            organizationCreated: (data) => app.organizationCreated(data),
          }
        : undefined,
    }),
});
