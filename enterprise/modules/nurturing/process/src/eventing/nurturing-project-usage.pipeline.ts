// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's own per-project usage (§9): one peer fold per owner pipeline (prompt, evaluator,
 * scenario, simulation run), a row per project each, and two trace-day peer folds, one over
 * trace's span_received and one over trace_failed, each keeping its own row per project and UTC
 * day; the usage read sums them, and only inside the organization's counting window.
 * Evaluations' UTC days are a peer map, one row per project and day. Each change syncs the
 * organization as one Customer.io group call, mirrored onto each member whose latest organization
 * it is (the emails read person attributes; members from nurturing's own copy of the owners'
 * member facts), placed by nurturing's own copy of project and organization creation. It reads no
 * other module's table and calls no other module's API. Without a Customer.io channel only the
 * copies register: nothing reads the usage rows. Why event driven:
 * https://github.com/langwatch/tasks/issues/1131.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import { SSO_AUTO_ADDED_EVENT_TYPE, ssoAutoAddedEventDataSchema } from "@langwatch/auth-contract";
import {
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  subscriptionChangedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import {
  GOVERNANCE_ATTR,
  GOVERNANCE_ORIGIN_KIND_VALUE,
} from "@langwatch/enterprise-governance-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
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
  type FoldProjectionStore,
  type LaneAlias,
  type PeerEvent,
  type PeerFoldProjectionDeclaration,
  type PeerFoldSubscriberSpec,
  type PeerMapProjectionDeclaration,
  type PeerSubscriberDefinition,
  type RoutedLaneAlias,
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
import { createLogger } from "@langwatch/observability";
import {
  INVITE_ACCEPTED_EVENT_TYPE,
  inviteAcceptedEventDataSchema,
  ORGANIZATION_CREATED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ADMITTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_LISTED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  type OrganizationCreatedEventData,
  organizationCreatedEventDataSchema,
  organizationMemberAdmittedEventDataSchema,
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
import { Temporal } from "@langwatch/time";
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
import { z } from "zod";

import type { NurturingModule } from "../app/nurturing.app.ts";
import type {
  NurturingEvaluationDay,
  NurturingEvaluationDayRepository,
} from "../repositories/nurturing-evaluation-day.repository.ts";
import type { NurturingVirtualKeyRepository } from "../repositories/nurturing-gateway-key.repository.ts";
import type {
  NurturingOrganizationAdminRepository,
  NurturingTraceMilestonesRepository,
} from "../repositories/nurturing-milestones.repository.ts";
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingOrganizationMemberRepository } from "../repositories/nurturing-organization-member.repository.ts";
import type { NurturingOrganizationPlanRepository } from "../repositories/nurturing-organization-plan.repository.ts";
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
import {
  NURTURING_TRACE_DAY_PROJECTION_VERSION,
  type NurturingTraceDayRepository,
} from "../repositories/nurturing-trace-day.repository.ts";
import type {
  NurturingTracedProjectRepository,
  NurturingTracedProjectRow,
} from "../repositories/nurturing-traced-project.repository.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import type { NurturingMembershipChange } from "../rules/nurturing-organization-member.rules.ts";
import {
  emptyPlanFold,
  foldPlanFact,
  type NurturingPlanFoldState,
  planFactOf,
} from "../rules/nurturing-organization-plan.rules.ts";
import { subscriptionChangedSignal } from "../rules/nurturing-owner-signals.rules.ts";
import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageFact,
  type NurturingProjectUsageState,
  TRACE_COUNTING_WINDOW_MS,
} from "../rules/nurturing-project-usage.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";
import {
  addCountedTrace,
  emptyTraceDay,
  type NurturingCountedTrace,
  type NurturingTraceDay,
  traceDayKeyOf,
} from "../rules/nurturing-trace-day.rules.ts";
import {
  type NurturingVirtualKeyFact,
  virtualKeyFactOf,
} from "../rules/nurturing-virtual-key.rules.ts";
import { nurturingSignalKey } from "./nurturing-signal.commands.ts";
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

function extractAttribute(
  attributes: z.output<typeof originAttributesSchema>,
  name: string,
): string | undefined {
  const value = attributes?.find(({ key }) => key === name)?.value.stringValue;
  return value ? value : undefined;
}

/** What the trace-day count reads of a span: whether it is a root, and its origins; no body. */
export type NurturingTraceSpanData = Readonly<{
  span: Pick<SpanReceivedEventData["span"], "parentSpanId">;
  /** The explicit origin, the span's own before its resource's, as trace hoists it. */
  origin?: string;
  /** The span's own `langwatch.origin.kind`, the one key trace hoists governance ingest by. */
  originKind?: string;
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
    origin:
      extractAttribute(attributes, ORIGIN_ATTRIBUTE) ??
      extractAttribute(resource?.attributes, ORIGIN_ATTRIBUTE),
    originKind: extractAttribute(attributes, GOVERNANCE_ATTR.ORIGIN_KIND),
  }));

/** Not a sample's or Langy's own trace, which trace's `isRealFirstIngest` leaves out too. */
function isCustomerOrigin(origin: string | undefined): boolean {
  return origin === undefined || !NON_CUSTOMER_ORIGINS.has(origin);
}

/**
 * Governance ingest, which lands in the organization's hidden governance project and which
 * trace's `isRealFirstIngest` leaves out too.
 */
function isGovernanceIngest(originKind: string | undefined): boolean {
  return originKind === GOVERNANCE_ORIGIN_KIND_VALUE;
}

/** A root span: one per trace, the only span the trace-day count takes. */
export function isRootSpan(data: NurturingTraceSpanData): boolean {
  return !data.span.parentSpanId;
}

/** A customer's trace: its root span, unless a sample's, Langy's own turn or governance ingest. */
export function isCountedTrace(data: NurturingTraceSpanData): boolean {
  return isRootSpan(data) && isCustomerOrigin(data.origin) && !isGovernanceIngest(data.originKind);
}

/** Lane names under `<host pipeline>.`, which the withMigrations steps in nurturing.module.ts name. */
export const NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME = "traceDaySpans" as const;
export const NURTURING_TRACE_DAY_FAILURES_PROJECTION_NAME = "traceDayFailures" as const;

/** What the failed-trace count reads of trace_failed: its project and origin. */
const failedTraceDataSchema = traceFailedEventDataSchema.pick({
  projectId: true,
  origin: true,
});

const TRACE_SPAN_EVENTS = [{ type: SPAN_RECEIVED_EVENT_TYPE, data: traceSpanDataSchema }] as const;
const TRACE_FAILED_EVENTS = [
  { type: TRACE_FAILED_EVENT_TYPE, data: failedTraceDataSchema },
] as const;

/** A fact as its count takes it: its project and the UTC day and time it was appended. */
export function countedTraceOf({
  projectId,
  kind,
  createdAt,
}: Readonly<{
  projectId: string;
  kind: NurturingCountedTrace["kind"];
  createdAt: number;
}>): NurturingCountedTrace {
  return { projectId, kind, day: utcDayOf(createdAt), at: createdAt };
}

/**
 * The state carries no newest occurredAt: neither fold re-folds (KEYED_FOLD_OPTIONS), so the
 * executor's out-of-order check reads 0 and folds each event on as it comes.
 */
const NO_LAST_EVENT_OCCURRED_AT = "LastEventOccurredAt";

/**
 * One project's traces per UTC day of append, from trace's span_received (§9): a customer root
 * span is one trace. Child, sample, Langy and governance-ingest spans mint no job (the enqueue
 * filter), and apply skips any a replay hands it. A redelivered batch folds once; a root span
 * stored again under a new event id counts again (issue 9378). Counts every organization's
 * traces: the read gates them.
 */
export function nurturingTraceDaySpansFold(
  store: FoldProjectionStore<NurturingTraceDay>,
): PeerFoldProjectionDeclaration<NurturingTraceDay, typeof TRACE_SPAN_EVENTS> {
  return {
    events: TRACE_SPAN_EVENTS,
    fold: {
      name: NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME,
      version: NURTURING_TRACE_DAY_PROJECTION_VERSION,
      eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
      init: () => emptyTraceDay(),
      apply: (state, { data, tenantId, createdAt }) =>
        isCountedTrace(data)
          ? addCountedTrace(
              state,
              countedTraceOf({ projectId: String(tenantId), kind: "trace", createdAt }),
            )
          : state,
      key: ({ tenantId, createdAt }) =>
        traceDayKeyOf({ projectId: String(tenantId), day: utcDayOf(createdAt) }),
      store,
      LastEventOccurredAtKey: NO_LAST_EVENT_OCCURRED_AT,
      options: { ...KEYED_FOLD_OPTIONS, enqueue: { filter: ({ data }) => isCountedTrace(data) } },
    },
  };
}

/**
 * One project's failed traces per UTC day of append, from trace's own trace_failed fact, in rows
 * of its own beside the spans fold's. Sample and Langy failures mint no job, and apply skips any a
 * replay hands it.
 */
export function nurturingTraceDayFailuresFold(
  store: FoldProjectionStore<NurturingTraceDay>,
): PeerFoldProjectionDeclaration<NurturingTraceDay, typeof TRACE_FAILED_EVENTS> {
  return {
    events: TRACE_FAILED_EVENTS,
    fold: {
      name: NURTURING_TRACE_DAY_FAILURES_PROJECTION_NAME,
      version: NURTURING_TRACE_DAY_PROJECTION_VERSION,
      eventTypes: [TRACE_FAILED_EVENT_TYPE],
      init: () => emptyTraceDay(),
      apply: (state, { data, createdAt }) =>
        isCustomerOrigin(data.origin)
          ? addCountedTrace(
              state,
              countedTraceOf({ projectId: data.projectId, kind: "failed", createdAt }),
            )
          : state,
      key: ({ data, createdAt }) =>
        traceDayKeyOf({ projectId: data.projectId, day: utcDayOf(createdAt) }),
      store,
      LastEventOccurredAtKey: NO_LAST_EVENT_OCCURRED_AT,
      options: {
        ...KEYED_FOLD_OPTIONS,
        enqueue: { filter: ({ data }) => isCustomerOrigin(data.origin) },
      },
    },
  };
}

/**
 * Where a trace-day replay starts: one counting window before `now`. Only an organization inside
 * its window has its trace days read, so an older day is never read.
 */
export function nurturingTraceDayReplaySince(now: number): string {
  return Temporal.Instant.fromEpochMilliseconds(now - TRACE_COUNTING_WINDOW_MS).toString();
}

/**
 * The retired trace-day subscribers' lanes: jobs the previous release queued under them reach the
 * fold over the same fact, which counts the same day.
 */
export const NURTURING_TRACE_DAY_LANE_ALIASES: readonly RoutedLaneAlias[] = [
  {
    from: `global:subscriber:${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.traceDayCount`,
    to: { jobType: "projection", lane: NURTURING_TRACE_DAY_SPANS_PROJECTION_NAME },
  },
  {
    from: `global:subscriber:${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.failedTraceDayCount`,
    to: { jobType: "projection", lane: NURTURING_TRACE_DAY_FAILURES_PROJECTION_NAME },
  },
];

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

/** Nurturing's own copies of owner facts, kept whether or not a channel syncs. */
export type NurturingUsageCopies = Readonly<{
  placements: NurturingProjectPlacementRepository;
  organizationsCreated: NurturingOrganizationCreatedRepository;
  /** Each organization's admin and seeded flag, folded from project's created facts. */
  admins: Pick<NurturingOrganizationAdminRepository, "recordAdminFact">;
  members: NurturingOrganizationMemberRepository;
  virtualKeys: NurturingVirtualKeyRepository;
  personalProjects: NurturingPersonalProjectRepository;
  tracedProjects: NurturingTracedProjectRepository;
  /** The organization's latest trace time, the trace half of the milestones table. */
  lastTraces: Pick<NurturingTraceMilestonesRepository, "recordLastTrace">;
}>;

/** What the usage sync needs; absent without a Customer.io channel, when nothing syncs. */
export type NurturingUsageSync = Readonly<{
  usageChanged: UsageChanged;
  /** A trace's sync: the organization's, unless its counting window has ended. */
  tracesChanged: UsageChanged;
  /** Names a new organization in Customer.io on its founder. */
  organizationCreated: (data: OrganizationCreatedEventData) => Promise<void>;
}>;

/**
 * Without a Customer.io channel nothing reads the evaluation days and nothing prunes them, so none
 * is kept; the lane still registers, so its replay step and its alias find it.
 */
const KEEP_NO_EVALUATION_DAYS: Pick<NurturingEvaluationDayRepository, "recordDays"> = {
  recordDays: async () => undefined,
};

/** The same for the trace days: their lanes register for their replay steps, and keep no row. */
const KEEP_NO_TRACE_DAYS: FoldProjectionStore<NurturingTraceDay> = {
  get: async () => ({ kind: "empty" }),
  getWithApplied: async () => ({ state: null, appliedEventIds: [], miss: "absent" }),
  store: async () => undefined,
};

function nurturingProjectUsageHost({
  store,
  evaluationDays,
  traceDays,
  copies,
  plans,
  sync,
  logger = createLogger("langwatch:nurturing:project-facts"),
}: Readonly<{
  store: NurturingProjectUsageRepository;
  /** Read only by the usage sync, which prunes it too. */
  evaluationDays: NurturingEvaluationDayRepository;
  /** Read only by the usage sync; pruned by it and by the window-end sweep. */
  traceDays: NurturingTraceDayRepository;
  copies: NurturingUsageCopies;
  plans: NurturingPlanCopy;
  sync: NurturingUsageSync | undefined;
  /** Where a traced fact naming no organization is logged. */
  logger?: ProjectFactsLogger;
}>) {
  const {
    organizationsCreated,
    admins,
    members,
    virtualKeys,
    personalProjects,
    tracedProjects,
    lastTraces,
  } = copies;
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
    .withPeerMapProjection(nurturingLastTracesMap(lastTraces))
    .withPeerMapProjection(
      nurturingEvaluationDaysMap(sync ? evaluationDays : KEEP_NO_EVALUATION_DAYS),
    )
    .withPeerFoldProjection(
      nurturingTraceDaySpansFold(sync ? traceDays.forSource("spans") : KEEP_NO_TRACE_DAYS),
    )
    .withPeerFoldProjection(
      nurturingTraceDayFailuresFold(sync ? traceDays.forSource("failures") : KEEP_NO_TRACE_DAYS),
    )
    // With or without a channel: a catch-up fact with no channel must fail its job, not vanish.
    .withPeerFoldProjection(nurturingOrganizationPlanFold(plans.store), [
      nurturingPlanSyncSubscriber(plans),
    ])
    .withLaneAliases([
      ...ORGANIZATION_COPY_LANE_ALIASES,
      ...PERSONAL_AND_TRACED_PROJECT_LANE_ALIASES,
      ...NURTURING_PROJECT_USAGE_LANE_ALIASES,
    ]);
  // Without a channel no sync reads the usage rows, so none is kept.
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
      // Throttled, not debounced: an organization tracing without pause still syncs once per
      // window, 15 minutes after the window's first trace, when its root spans are counted.
      .withPeerSubscriber("firstTraceUsageSync", traceSyncs.firstTrace)
      .withPeerSubscriber("traceUsageSync", traceSyncs.laterTrace)
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
}: Readonly<{
  placements: Pick<NurturingProjectPlacementRepository, "recordProject">;
}>): PeerMapProjectionDeclaration<NurturingPlacementFact, typeof PROJECT_CREATED_EVENTS> {
  return {
    events: PROJECT_CREATED_EVENTS,
    map: {
      name: NURTURING_PROJECT_PLACEMENTS_PROJECTION_NAME,
      eventTypes: [PROJECT_CREATED_EVENT_TYPE],
      map: ({ data: { projectId, organizationId } }) => ({ projectId, organizationId }),
      store: { append: (placement) => placements.recordProject(placement) },
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
  {
    type: ORGANIZATION_MEMBER_ADMITTED_EVENT_TYPE,
    data: organizationMemberAdmittedEventDataSchema,
  },
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
 * What one organization member fact tells the copy: a membership change, or nothing because a
 * provisioned organization's creation names no founder.
 */
export type NurturingMembershipFactResult =
  | Readonly<{ kind: "membership"; fact: NurturingMembershipFact }>
  | Readonly<{ kind: "none"; reason: "no-founder" }>;

const membership = (fact: NurturingMembershipFact): NurturingMembershipFactResult => ({
  kind: "membership",
  fact,
});

/**
 * Organization's member fact as the copy keeps it, at the fact's time. A creation joins its
 * founder, since an organization created for an existing user (`createAndAssign`) records no
 * signup; a provisioned one names no founder and keeps nothing. A listed member joined when
 * organization's membership row was created.
 */
export function organizationMembershipFactOf(
  event: PeerEvent<typeof ORGANIZATION_MEMBER_EVENTS>,
): NurturingMembershipFactResult {
  const { organizationId, occurredAt } = event.data;
  switch (event.type) {
    case ORGANIZATION_CREATED_EVENT_TYPE: {
      const { userId } = event.data;
      if (!userId) return { kind: "none", reason: "no-founder" };
      return membership({ organizationId, userId, change: "joined", at: occurredAt });
    }
    case ORGANIZATION_SIGNED_UP_EVENT_TYPE:
    case INVITE_ACCEPTED_EVENT_TYPE:
    case ORGANIZATION_MEMBER_ADMITTED_EVENT_TYPE:
      return membership({
        organizationId,
        userId: event.data.userId,
        change: "joined",
        at: occurredAt,
      });
    case ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE:
    case ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE:
      return membership({
        organizationId,
        userId: event.data.userId,
        change: "left",
        at: occurredAt,
      });
    case ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE:
      return membership({
        organizationId,
        userId: event.data.userId,
        change: "returned",
        at: occurredAt,
      });
    case ORGANIZATION_MEMBER_LISTED_EVENT_TYPE:
      return membership({
        organizationId,
        userId: event.data.userId,
        change: "joined",
        at: event.data.joinedAt,
      });
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
      map: (event) => {
        const result = organizationMembershipFactOf(event);
        return result.kind === "membership" ? result.fact : null;
      },
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
export const NURTURING_TRACED_PROJECTS_OF_TRACE_PROJECTION_NAME = "tracedProjectsOfTrace" as const;
export const NURTURING_TRACED_PROJECTS_OF_PROJECT_PROJECTION_NAME =
  "tracedProjectsOfProject" as const;
export const NURTURING_LAST_TRACES_PROJECTION_NAME = "lastTraces" as const;

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
 * What one traced-project fact tells the copy: its row, or none for a project with no organization.
 */
type TracedProjectResult =
  | Readonly<{ kind: "traced"; row: NurturingTracedProjectRow }>
  | Readonly<{ kind: "none"; reason: "no-organization" }>;

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
}>): TracedProjectResult {
  if (organizationId === null) {
    logger.warn(
      { projectId },
      "a traced project names no organization; nurturing keeps no traced row for it",
    );
    return { kind: "none", reason: "no-organization" };
  }
  return { kind: "traced", row: { projectId, organizationId } };
}

/**
 * Nurturing's copy of the projects that traced, from trace's `project_traced` fact; insert-ignore.
 */
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
      map: ({ data }) => {
        const result = tracedProjectOf({ data, logger });
        return result.kind === "traced" ? result.row : null;
      },
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
      map: ({ data }) => {
        const result = tracedProjectOf({ data, logger });
        return result.kind === "traced" ? result.row : null;
      },
      store: { append: (row) => tracedProjects.recordTraced(row) },
    },
  };
}

const LAST_TRACE_EVENTS = [
  { type: FIRST_TRACE_RECORDED_EVENT_TYPE, data: firstTraceRecordedEventDataSchema },
  { type: TRACE_RECEIVED_EVENT_TYPE, data: traceReceivedEventDataSchema },
] as const;

/** Most trace facts of one organization the queue drains into one write. */
const LAST_TRACE_COALESCE_MAX_BATCH = 500;

/** An organization's trace time as one fact names it. */
type LastTrace = Readonly<{ organizationId: string; occurredAt: number }>;

/**
 * Nurturing's copy of an organization's latest trace time, from trace's first and later trace
 * facts, told to a person who joins later. A fact naming no organization (an older one) maps to
 * nothing and mints no job. The time only moves forward in the store, so any order and any
 * repeat leave the same row; a coalesced batch is one organization's, written as its latest.
 */
export function nurturingLastTracesMap(
  lastTraces: Pick<NurturingTraceMilestonesRepository, "recordLastTrace">,
): PeerMapProjectionDeclaration<LastTrace, typeof LAST_TRACE_EVENTS> {
  return {
    events: LAST_TRACE_EVENTS,
    map: {
      name: NURTURING_LAST_TRACES_PROJECTION_NAME,
      eventTypes: LAST_TRACE_EVENTS.map(({ type }) => type),
      map: ({ data: { organizationId, occurredAt } }) =>
        organizationId === undefined ? null : { organizationId, occurredAt },
      options: {
        enqueue: { filter: ({ data }) => data.organizationId !== undefined },
        groupKeyFn: ({ data }) => `lastTrace:${data.organizationId}`,
        coalesceMaxBatch: LAST_TRACE_COALESCE_MAX_BATCH,
      },
      store: {
        append: (trace) => lastTraces.recordLastTrace(trace),
        bulkAppend: async (traces) => {
          const latest = new Map<string, number>();
          for (const { organizationId, occurredAt } of traces) {
            latest.set(organizationId, Math.max(latest.get(organizationId) ?? 0, occurredAt));
          }
          for (const [organizationId, occurredAt] of latest) {
            await lastTraces.recordLastTrace({ organizationId, occurredAt });
          }
        },
      },
    },
  };
}

/** Lane name under `<host pipeline>.`, which a withMigrations step in nurturing.module.ts names. */
export const NURTURING_EVALUATION_DAYS_PROJECTION_NAME = "evaluationDays" as const;

const EVALUATION_DAY_EVENTS = [
  {
    type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
    data: evaluationLifecycleCompletedEventDataSchema,
  },
] as const;

/**
 * Where the evaluation-day replay starts: 31 days before 2026-11-19, the earliest this release can
 * ship. The usage read reaches 30 days back, so a later release only replays days it never reads.
 */
export const NURTURING_EVALUATION_DAYS_REPLAY_SINCE = "2026-10-19T00:00:00Z";

/** Most evaluations of one project and day the queue drains into one batch, one insert. */
const EVALUATION_DAY_COALESCE_MAX_BATCH = 500;

/** The queue group of an evaluation: its project and UTC day, the one row it can add. */
export function evaluationDayGroupOf(event: Event): string {
  const { data } = event as Event<{ projectId?: unknown }>;
  const projectId = typeof data?.projectId === "string" ? data.projectId : String(event.tenantId);
  return JSON.stringify([projectId, utcDayOf(event.occurredAt)]);
}

/**
 * Nurturing's own evaluation days, from evaluation's settled facts (§9): the fact's project and
 * UTC day, written insert-ignore, so a redelivered, late or replayed fact leaves the copy as live
 * delivery would. No sync of their own: the next usage sync reads them. A burst of one project's
 * evaluations on one day is coalesced into one write.
 */
export function nurturingEvaluationDaysMap(
  evaluationDays: Pick<NurturingEvaluationDayRepository, "recordDays">,
): PeerMapProjectionDeclaration<NurturingEvaluationDay, typeof EVALUATION_DAY_EVENTS> {
  return {
    events: EVALUATION_DAY_EVENTS,
    map: {
      name: NURTURING_EVALUATION_DAYS_PROJECTION_NAME,
      eventTypes: [EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE],
      map: ({ data: { projectId, occurredAt } }) => ({ projectId, day: utcDayOf(occurredAt) }),
      store: {
        append: (day) => evaluationDays.recordDays([day]),
        bulkAppend: (days) => evaluationDays.recordDays(days),
      },
      options: {
        groupKeyFn: evaluationDayGroupOf,
        coalesceMaxBatch: EVALUATION_DAY_COALESCE_MAX_BATCH,
      },
    },
  };
}

/**
 * The retired evaluation-day subscriber's lane: jobs the previous release queued under it reach
 * the evaluation-day map, which writes the same day.
 */
export const NURTURING_EVALUATION_ACTIVE_DAY_LANE_ALIAS: RoutedLaneAlias = {
  from: `global:subscriber:${NURTURING_PROJECT_USAGE_PIPELINE_NAME}.evaluationActiveDay`,
  to: { jobType: "handler", lane: NURTURING_EVALUATION_DAYS_PROJECTION_NAME },
};

/** Lane name under `<host pipeline>.`, which a withMigrations step in nurturing.module.ts names. */
export const NURTURING_ORGANIZATION_PLANS_PROJECTION_NAME = "organizationPlans" as const;

const PLAN_EVENTS = [
  { type: SUBSCRIPTION_CHANGED_EVENT_TYPE, data: subscriptionChangedEventDataSchema },
] as const;

/** Nurturing's plan copy, and the send of a fact that won it. */
export type NurturingPlanCopy = Readonly<{
  store: NurturingOrganizationPlanRepository;
  /**
   * Tells Customer.io the plan: a live fact is claimed, a catch-up with no channel rejects, and a
   * refused request rejects, so the job retries.
   */
  deliver: (input: Readonly<{ key: string; signal: NurturingSignal }>) => Promise<void>;
}>;

/**
 * Nurturing's plan copy, folded from billing's subscription_changed facts (§9), one row per
 * organization: billing keys the facts by organization, so the fold's aggregate is one and a
 * replay rebuilds each row from its own log. The newest fact wins and a real fact wins a tie
 * (`planFactChangesCopy`); the winner's event id is kept beside it. Folding commutes, so a late
 * fact is folded as it comes rather than re-folding the organization's log.
 */
export function nurturingOrganizationPlanFold(
  store: NurturingOrganizationPlanRepository,
): PeerFoldProjectionDeclaration<NurturingPlanFoldState, typeof PLAN_EVENTS> {
  return {
    events: PLAN_EVENTS,
    fold: {
      name: NURTURING_ORGANIZATION_PLANS_PROJECTION_NAME,
      version: "2026-11-19",
      eventTypes: [SUBSCRIPTION_CHANGED_EVENT_TYPE],
      init: emptyPlanFold,
      apply: (state, event) =>
        foldPlanFact(state, { eventId: event.id, fact: planFactOf(event.data) }),
      store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
      options: { refoldOnOutOfOrder: false },
    },
  };
}

/**
 * The plan fold's send: only the fact that won the fold tells Customer.io, so an older, tied or
 * redelivered losing fact mints no job, and a replay, which runs no subscriber, sends nothing. The
 * fold commits first; a refused send fails this job alone, and its retry sends again unless a
 * newer fact has won the copy since.
 */
export function nurturingPlanSyncSubscriber({
  store,
  deliver,
}: NurturingPlanCopy): PeerFoldSubscriberSpec<NurturingPlanFoldState> {
  return {
    name: "planSync",
    when: (event, { state }) => state.winnerEventId === event.id,
    handler: async (event) => {
      const organizationId = String(event.aggregateId);
      // The job carries the state its fold committed; a retry reads the copy as it is now.
      const current = await store.get(organizationId, {
        aggregateId: organizationId,
        tenantId: event.tenantId,
      });
      if (current.kind !== "folded" || current.state.winnerEventId !== event.id) return;
      const data = subscriptionChangedEventDataSchema.parse(event.data);
      const signal = subscriptionChangedSignal({ data, aggregateId: organizationId });
      await deliver({ key: nurturingSignalKey(signal), signal });
    },
  };
}

/**
 * The retired subscriptionChanged subscriber's lane: jobs the previous release queued under it
 * reach the plan fold, whose subscriber still sends the fact that wins.
 */
export const NURTURING_SUBSCRIPTION_CHANGED_LANE_ALIAS: RoutedLaneAlias = {
  from: `global:subscriber:${NURTURING_PIPELINE_NAME}.subscriptionChanged`,
  to: { jobType: "projection", lane: NURTURING_ORGANIZATION_PLANS_PROJECTION_NAME },
};

/** The host's retired lanes, each taken by its successor while an older release may hold jobs. */
export const NURTURING_PROJECT_USAGE_LANE_ALIASES: readonly LaneAlias[] = [
  NURTURING_EVALUATION_ACTIVE_DAY_LANE_ALIAS,
  NURTURING_SUBSCRIPTION_CHANGED_LANE_ALIAS,
  ...NURTURING_TRACE_DAY_LANE_ALIASES,
];

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
      evaluationDays: repositories.evaluationDays,
      traceDays: repositories.traceDays,
      copies: {
        placements: repositories.placements,
        organizationsCreated: repositories.organizationsCreated,
        admins: repositories.milestones,
        members: repositories.members,
        virtualKeys: repositories.virtualKeys,
        personalProjects: repositories.personalProjects,
        tracedProjects: repositories.tracedProjects,
        lastTraces: repositories.milestones,
      },
      plans: { store: repositories.plans, deliver: (input) => app.deliverPlan(input) },
      sync: app.syncsOrganizationUsage()
        ? {
            usageChanged: (input) => app.organizationUsageChanged(input),
            tracesChanged: (input) => app.organizationTracesChanged(input),
            organizationCreated: (data) => app.organizationCreated(data),
          }
        : undefined,
    }),
});
