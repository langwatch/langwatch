// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's own per-project usage (§9): one peer fold per owner pipeline (prompt, evaluator,
 * scenario, simulation run), a row per project each, and subscribers on trace's span_received and
 * trace_failed counting each trace and failed trace once into its project's UTC day, one statement
 * a batch, while the organization is inside its counting window.
 * Evaluations add a day per project a day. Each change syncs the organization as one Customer.io
 * group call, mirrored onto each member whose latest organization it is (the emails read person
 * attributes), placed by nurturing's own copy of project and organization creation. Without a
 * Customer.io channel nothing reads these rows, so nothing here is registered. Why event
 * driven: https://github.com/langwatch/tasks/issues/1131.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
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
  type PeerEvent,
  type PeerBatchSubscriberDefinition,
  type PeerFoldProjectionDeclaration,
  type PeerFoldSubscriberSpec,
  type PeerSubscriberContext,
  type PeerSubscriberDefinition,
  throttledWindow,
} from "@langwatch/eventing";
import {
  ORGANIZATION_CREATED_EVENT_TYPE,
  organizationCreatedEventDataSchema,
} from "@langwatch/organization-contract";
import {
  PROJECT_CREATED_EVENT_TYPE,
  projectCreatedEventDataSchema,
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
  SPAN_RECEIVED_EVENT_TYPE,
  type SpanReceivedEventData,
  spanReceivedEventDataSchema,
  TRACE_FAILED_EVENT_TYPE,
  TRACE_RECEIVED_EVENT_TYPE,
  traceFailedEventDataSchema,
  traceReceivedEventDataSchema,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type { NurturingModule } from "../app/nurturing.app.ts";
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
import type { NurturingProjectDirectoryRepository } from "../repositories/nurturing-project-directory.repository.ts";
import type { NurturingProjectPlacementRepository } from "../repositories/nurturing-project-placement.repository.ts";
import {
  NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
  type NurturingProjectUsageOwner,
  type NurturingProjectUsageRepository,
} from "../repositories/nurturing-project-usage.repository.ts";
import type { NurturingTraceDayRepository } from "../repositories/nurturing-trace-day.repository.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import {
  emptyProjectUsage,
  foldProjectUsage,
  isTraceCounted,
  type NurturingProjectUsageFact,
  type NurturingProjectUsageState,
} from "../rules/nurturing-project-usage.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";
import type { NurturingCountedTrace } from "../rules/nurturing-trace-day.rules.ts";

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

/** What the trace-day count reads of a span: its trace, root or not, and origin; no body. */
export type NurturingTraceSpanData = Readonly<{
  span: Pick<SpanReceivedEventData["span"], "traceId" | "parentSpanId">;
  /** The explicit origin, the span's own before its resource's, as trace hoists it. */
  origin?: string;
}>;

const traceSpanDataSchema = z
  .object({
    span: spanReceivedEventDataSchema.shape.span
      .pick({ traceId: true, parentSpanId: true })
      .extend({ attributes: originAttributesSchema }),
    resource: z.object({ attributes: originAttributesSchema }).nullish(),
  })
  .transform(
    ({ span: { traceId, parentSpanId, attributes }, resource }): NurturingTraceSpanData => ({
      span: { traceId, parentSpanId },
      origin: extractOrigin(attributes) ?? extractOrigin(resource?.attributes),
    }),
  );

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

/** A root span as its count takes it: its project (the tenant), trace and append day. */
export function countedTraceOf({
  data,
  context,
}: Readonly<{
  data: NurturingTraceSpanData;
  context: Pick<PeerSubscriberContext, "tenantId" | "createdAt">;
}>): NurturingCountedTrace {
  return {
    projectId: String(context.tenantId),
    traceId: data.span.traceId,
    kind: "trace",
    day: utcDayOf(context.createdAt),
    at: context.createdAt,
  };
}

/** What the trace and failure counts read to keep only organizations in their window. */
export type NurturingTraceCountingDeps = Readonly<{
  traceDays: NurturingTraceDayRepository;
  placements: Pick<NurturingProjectPlacementRepository, "getPlacement">;
  organizationsCreated: Pick<NurturingOrganizationCreatedRepository, "findOrganizationCreatedAt">;
  /** The owners' rows, asked only when nurturing's copy has not landed. */
  directory: Pick<NurturingProjectDirectoryRepository, "getPlacement" | "getOrganizationCreatedAt">;
}>;

/** A project's organization creation, from nurturing's copies or, if one lags, its owners'. */
type ProjectOrganizationCreation =
  | Readonly<{ outcome: "copied"; organizationCreatedAt: number }>
  | Readonly<{ outcome: "notCopied"; organizationCreatedAt: number | null }>;

async function projectOrganizationCreationOf({
  projectId,
  placements,
  organizationsCreated,
  directory,
}: Readonly<{ projectId: string }> &
  Omit<NurturingTraceCountingDeps, "traceDays">): Promise<ProjectOrganizationCreation> {
  const placement = await placements.getPlacement({ projectId });
  if (placement.outcome === "known") {
    const { organizationCreatedAt } = await organizationsCreated.findOrganizationCreatedAt({
      organizationId: placement.organizationId,
    });
    if (organizationCreatedAt !== null) return { outcome: "copied", organizationCreatedAt };
  }
  const owned = await directory.getPlacement({ projectId });
  if (owned.outcome !== "known") return { outcome: "notCopied", organizationCreatedAt: null };
  const { organizationCreatedAt } = await directory.getOrganizationCreatedAt({
    organizationId: owned.organizationId,
  });
  return { outcome: "notCopied", organizationCreatedAt };
}

/**
 * Counts the batch's traces whose organization is inside its counting window, each once,
 * durably (the repository's per-trace rows). Past the window nothing reads the counts. Copies
 * are written by their own subscribers, so a new project's first traces can come first: then the
 * batch throws after counting the rest, and the queue retries until the copy lands.
 */
async function countInWindow({
  traces,
  ...deps
}: Readonly<{ traces: readonly NurturingCountedTrace[] }> &
  NurturingTraceCountingDeps): Promise<void> {
  if (traces.length === 0) return;
  const creations = new Map(
    await Promise.all(
      [...new Set(traces.map(({ projectId }) => projectId))].map(
        async (projectId) =>
          [projectId, await projectOrganizationCreationOf({ projectId, ...deps })] as const,
      ),
    ),
  );
  const inWindow = (trace: NurturingCountedTrace) =>
    isTraceCounted({
      organizationCreatedAt: creations.get(trace.projectId)?.organizationCreatedAt ?? null,
      at: trace.at,
    });
  const copied = (trace: NurturingCountedTrace) =>
    creations.get(trace.projectId)?.outcome === "copied";
  await deps.traceDays.countTraces(traces.filter((trace) => copied(trace) && inWindow(trace)));
  const waiting = [
    ...new Set(
      traces.filter((trace) => !copied(trace) && inWindow(trace)).map(({ projectId }) => projectId),
    ),
  ];
  if (waiting.length > 0) {
    throw new Error(
      `nurturing's copy of the placement or organization creation of ${waiting.join(", ")} has not landed yet`,
    );
  }
}

/** Most root spans of one project and day the queue drains into one batch, one upsert. */
const TRACE_DAY_COALESCE_MAX_BATCH = 500;

/** The queue group of a span: its project and UTC day, the row its count lands on. */
export function traceDayGroupOf(event: Event): string {
  return JSON.stringify([String(event.tenantId), utcDayOf(event.createdAt)]);
}

/**
 * One project's traces per UTC day: root spans of one project and day are coalesced, and each
 * batch counts its traces once each in one Postgres statement, so a re-stored trace or a
 * redelivered batch counts nothing again. Only organizations in their counting window count. Not
 * a fold, so no replay rebuilds the rows. Child, sample and Langy spans mint no job; the handler
 * drops any staged.
 */
export function nurturingTraceDaySubscriber(
  deps: NurturingTraceCountingDeps,
): PeerBatchSubscriberDefinition<typeof traceSpanDataSchema> {
  return {
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    data: traceSpanDataSchema,
    options: {
      enqueue: { filter: isCountedTrace },
      groupKeyFn: traceDayGroupOf,
      coalesceMaxBatch: TRACE_DAY_COALESCE_MAX_BATCH,
    },
    handleBatch: (items) =>
      countInWindow({
        ...deps,
        traces: items
          .filter(({ data }) => isCountedTrace(data))
          .map(({ data, context }) => countedTraceOf({ data, context })),
      }),
  };
}

/** What the failed-trace count reads of trace_failed: its project, trace and origin. */
const failedTraceDataSchema = traceFailedEventDataSchema.pick({
  projectId: true,
  traceId: true,
  origin: true,
});

/**
 * One project's failed traces per UTC day, from trace's own trace_failed fact (once per trace,
 * by trace's rule) on the day it was appended, counted once per trace as the trace count is, so a
 * redelivered fact counts nothing again. Sample and Langy failures mint no job; the handler drops
 * any staged.
 */
export function nurturingFailedTraceDaySubscriber(
  deps: NurturingTraceCountingDeps,
): PeerBatchSubscriberDefinition<typeof failedTraceDataSchema> {
  return {
    eventType: TRACE_FAILED_EVENT_TYPE,
    data: failedTraceDataSchema,
    options: {
      enqueue: { filter: ({ origin }) => isCustomerOrigin(origin) },
      groupKeyFn: traceDayGroupOf,
      coalesceMaxBatch: TRACE_DAY_COALESCE_MAX_BATCH,
    },
    handleBatch: (items) =>
      countInWindow({
        ...deps,
        traces: items
          .filter(({ data }) => isCustomerOrigin(data.origin))
          .map(({ data, context }) => ({
            projectId: data.projectId,
            traceId: data.traceId,
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
 * counts its root span added, so the first trace is counted once.
 */
export function nurturingTraceUsageSyncSubscribers(usageChanged: UsageChanged): Readonly<{
  firstTrace: PeerSubscriberDefinition<typeof firstTraceSyncDataSchema>;
  laterTrace: PeerSubscriberDefinition<typeof traceSyncDataSchema>;
}> {
  const { delay, dedup } = throttledWindow<Event>({
    makeId: traceSyncKeyOf,
    windowMs: TRACE_USAGE_SYNC_WINDOW_MS,
  });
  const options = { delay, deduplication: dedup };
  return {
    firstTrace: {
      eventType: FIRST_TRACE_RECORDED_EVENT_TYPE,
      data: firstTraceSyncDataSchema,
      options,
      handle: ({ projectId }) => usageChanged({ projectId }),
    },
    laterTrace: {
      eventType: TRACE_RECEIVED_EVENT_TYPE,
      data: traceSyncDataSchema,
      options,
      handle: ({ projectId }) => usageChanged({ projectId }),
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

/** What the usage sync needs; absent without a Customer.io channel, when nothing syncs. */
export type NurturingUsageSync = Readonly<{
  traceDays: NurturingTraceDayRepository;
  placements: NurturingProjectPlacementRepository;
  organizationsCreated: NurturingOrganizationCreatedRepository;
  directory: NurturingTraceCountingDeps["directory"];
  usageChanged: UsageChanged;
}>;

function nurturingProjectUsageHost({
  store,
  sync,
}: Readonly<{
  store: NurturingProjectUsageRepository;
  sync: NurturingUsageSync | undefined;
}>) {
  const host = definePipeline({
    name: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "nurturing_project_usage_view" }),
  }).withEvents([]);
  // Without a channel no sync reads these rows, and none prunes the trace days, so none is kept.
  if (!sync) return host;
  const { traceDays, placements, organizationsCreated, directory, usageChanged } = sync;
  const counting = { traceDays, placements, organizationsCreated, directory };
  const subscribers = [organizationUsageSubscriber(usageChanged)];
  const traceSyncs = nurturingTraceUsageSyncSubscribers(usageChanged);
  return (
    host
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
      .withPeerSubscriber("traceDayCount", nurturingTraceDaySubscriber(counting))
      .withPeerSubscriber("failedTraceDayCount", nurturingFailedTraceDaySubscriber(counting))
      // Throttled, not debounced: an organization tracing without pause still syncs once per
      // window, 15 minutes after the window's first trace, when its root spans are counted.
      .withPeerSubscriber("firstTraceUsageSync", traceSyncs.firstTrace)
      .withPeerSubscriber("traceUsageSync", traceSyncs.laterTrace)
      .withPeerSubscriber("evaluationActiveDay", nurturingEvaluationDaySubscriber(store))
      .withPeerSubscriber("projectPlacement", nurturingProjectPlacementSubscriber(placements))
      .withPeerSubscriber(
        "organizationCreated",
        nurturingOrganizationCreatedSubscriber(organizationsCreated),
      )
  );
}

/**
 * Nurturing's own copy of a project's organization, from project's creation fact (§9). A move
 * stays within the organization and an archived project stays counted, so only creation writes.
 */
export function nurturingProjectPlacementSubscriber(
  placements: NurturingProjectPlacementRepository,
): PeerSubscriberDefinition<typeof projectCreatedEventDataSchema> {
  return {
    eventType: PROJECT_CREATED_EVENT_TYPE,
    data: projectCreatedEventDataSchema,
    handle: ({ projectId, organizationId }) =>
      placements.recordProject({ projectId, organizationId }),
  };
}

/** Nurturing's own copy of an organization's creation, the signup day of its usage traits. */
export function nurturingOrganizationCreatedSubscriber(
  organizationsCreated: NurturingOrganizationCreatedRepository,
): PeerSubscriberDefinition<typeof organizationCreatedEventDataSchema> {
  return {
    eventType: ORGANIZATION_CREATED_EVENT_TYPE,
    data: organizationCreatedEventDataSchema,
    handle: ({ organizationId, occurredAt }) =>
      organizationsCreated.recordOrganizationCreated({ organizationId, createdAt: occurredAt }),
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
      sync: app.syncsOrganizationUsage()
        ? {
            traceDays: repositories.traceDays,
            placements: repositories.placements,
            organizationsCreated: repositories.organizationsCreated,
            directory: repositories.projects,
            usageChanged: (input) => app.organizationUsageChanged(input),
          }
        : undefined,
    }),
});
