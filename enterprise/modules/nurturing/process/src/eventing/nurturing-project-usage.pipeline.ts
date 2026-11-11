// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's own per-project usage (§9): one peer fold per owner pipeline (prompt, evaluator,
 * scenario, simulation run), a row per project each, and a subscriber on trace's span_received
 * that adds its root spans to their project's UTC day with one Postgres upsert per batch.
 * Evaluations add a day per project a day. Each change syncs the organization as one Customer.io
 * group call, placed by nurturing's own copy of project and organization creation. Without a
 * Customer.io channel nothing reads these rows, so nothing here is registered. See ADR 001
 * (nurturing), amendment.
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
  SPAN_RECEIVED_EVENT_TYPE,
  spanReceivedEventDataSchema,
  TRACE_RECEIVED_EVENT_TYPE,
  traceReceivedEventDataSchema,
} from "@langwatch/trace-contract";
import { z } from "zod";

import type { NurturingModule } from "../app/nurturing.app.ts";
import type { NurturingOrganizationCreatedRepository } from "../repositories/nurturing-organization-created.repository.ts";
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
  type NurturingProjectUsageFact,
  type NurturingProjectUsageState,
} from "../rules/nurturing-project-usage.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";
import {
  type NurturingTraceSpan,
  traceDayIncrementsOf,
} from "../rules/nurturing-trace-day.rules.ts";

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

/** The dedup key of an evaluation: its project's UTC day, so each day writes once. */
export function evaluationDayKeyOf(event: Event): string {
  const { data } = event as Event<{ projectId?: unknown }>;
  const projectId = typeof data?.projectId === "string" ? data.projectId : String(event.tenantId);
  return `subscriber:evaluationActiveDay:${projectId}:${utcDayOf(event.occurredAt)}`;
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

/** What the trace-day count reads of a span: whether it is a root, and its status; no body. */
const traceSpanDataSchema = z.object({
  span: spanReceivedEventDataSchema.shape.span.pick({ parentSpanId: true, status: true }),
});

type NurturingTraceSpanData = z.output<typeof traceSpanDataSchema>;

/** OTLP's `STATUS_CODE_ERROR`: the status trace's rollup counts a failed trace by. */
const OTLP_STATUS_CODE_ERROR = 2;

/** A root span: one per trace, the only span the trace-day count takes. */
export function isRootSpan(data: NurturingTraceSpanData): boolean {
  return !data.span.parentSpanId;
}

/** A root span as its count takes it: its project (the tenant), append day, and failure. */
export function traceSpanOf(
  data: NurturingTraceSpanData,
  context: Pick<PeerSubscriberContext, "tenantId" | "createdAt">,
): NurturingTraceSpan {
  return {
    projectId: String(context.tenantId),
    day: utcDayOf(context.createdAt),
    isError: data.span.status.code === OTLP_STATUS_CODE_ERROR,
    appendedAt: context.createdAt,
  };
}

/** Most root spans of one project and day the queue drains into one batch, one upsert. */
const TRACE_DAY_COALESCE_MAX_BATCH = 500;

/** The queue group of a span: its project and UTC day, the row its count lands on. */
export function traceDayGroupOf(event: Event): string {
  return JSON.stringify([String(event.tenantId), utcDayOf(event.createdAt)]);
}

/**
 * One project's traces per UTC day: root spans of one project and day are coalesced, and each
 * batch adds its counts to the day in one Postgres upsert. Not idempotent: a redelivered batch,
 * or a retry after the write committed, counts its traces again. A subscriber, not a fold, so
 * the rows are not rebuilt by a projection replay. Child spans mint no job.
 */
export function nurturingTraceDaySubscriber(
  traceDays: NurturingTraceDayRepository,
): PeerBatchSubscriberDefinition<typeof traceSpanDataSchema> {
  return {
    eventType: SPAN_RECEIVED_EVENT_TYPE,
    data: traceSpanDataSchema,
    options: {
      enqueue: { filter: isRootSpan },
      groupKeyFn: traceDayGroupOf,
      coalesceMaxBatch: TRACE_DAY_COALESCE_MAX_BATCH,
    },
    handleBatch: (items) =>
      traceDays.addTraceDays(
        traceDayIncrementsOf(items.map(({ data, context }) => traceSpanOf(data, context))),
      ),
  };
}

type UsageChanged = (input: Readonly<{ projectId: string }>) => Promise<void>;

/**
 * Each fold's subscriber: debounced per project, so a burst of one owner's facts sends once. The
 * framework keeps each subscriber's dedup to its own lane, so facts of several owners in the same
 * minute send once per owner; each send is the organization's whole sum, so a repeat is harmless.
 */
function organizationUsageSubscriber(
  usageChanged: UsageChanged,
): PeerFoldSubscriberSpec<NurturingProjectUsageState> {
  return {
    name: "organizationUsage",
    delay: USAGE_SYNC_DELAY_MS,
    dedup: {
      makeId: (event) => `project:${projectIdOf(event as NurturingProjectUsagePeerEvent)}`,
      ttlMs: USAGE_SYNC_DELAY_MS,
      extend: true,
      replace: true,
    },
    handler: (_event, { state }) => usageChanged({ projectId: state.projectId }),
  };
}

/** What the trace sync reads of trace_received; its throttle reads the organization. */
const traceSyncDataSchema = traceReceivedEventDataSchema.pick({ projectId: true });

/** What the usage sync needs; absent without a Customer.io channel, when nothing syncs. */
export type NurturingUsageSync = Readonly<{
  traceDays: NurturingTraceDayRepository;
  placements: NurturingProjectPlacementRepository;
  organizationsCreated: NurturingOrganizationCreatedRepository;
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
  const { traceDays, placements, organizationsCreated, usageChanged } = sync;
  const subscribers = [organizationUsageSubscriber(usageChanged)];
  const traceSync = throttledWindow<Event>({
    makeId: traceSyncKeyOf,
    windowMs: TRACE_USAGE_SYNC_WINDOW_MS,
  });
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
      .withPeerSubscriber("traceDayCount", nurturingTraceDaySubscriber(traceDays))
      // Throttled, not debounced: an organization tracing without pause still syncs once per
      // window, 15 minutes after the window's first trace, when its root spans are counted.
      .withPeerSubscriber("traceUsageSync", {
        eventType: TRACE_RECEIVED_EVENT_TYPE,
        data: traceSyncDataSchema,
        options: { delay: traceSync.delay, deduplication: traceSync.dedup },
        handle: (data) => usageChanged({ projectId: data.projectId }),
      })
      // Evaluations count only as habit days, which the next sync reads: no sync of their own.
      .withPeerSubscriber("evaluationActiveDay", {
        eventType: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
        data: evaluationLifecycleCompletedEventDataSchema,
        options: {
          deduplication: {
            makeId: evaluationDayKeyOf,
            ttlMs: EVALUATION_DAY_DEDUP_TTL_MS,
            extend: false,
            replace: false,
            shouldSurviveDispatch: true,
          },
        },
        handle: ({ projectId, occurredAt }) => store.recordEvaluationDay({ projectId, occurredAt }),
      })
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
            usageChanged: (input) => app.organizationUsageChanged(input),
          }
        : undefined,
    }),
});
