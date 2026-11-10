// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's own per-project usage (§9): one peer fold per owner pipeline (prompt, evaluator,
 * scenario, simulation run), a row per project each, and a fold over trace's span_received that
 * counts root spans per project and UTC day. Evaluations add a day per project a day. Each change
 * syncs the organization as one Customer.io group call. See ADR 001 (nurturing), amendment.
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
  type PeerFoldProjectionDeclaration,
  type PeerFoldSubscriberSpec,
  throttledWindow,
} from "@langwatch/eventing";
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
import {
  NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
  type NurturingProjectUsageOwner,
  type NurturingProjectUsageRepository,
} from "../repositories/nurturing-project-usage.repository.ts";
import {
  NURTURING_TRACE_DAY_PROJECTION_VERSION,
  type NurturingTraceDayRepository,
  traceDayKey,
} from "../repositories/nurturing-trace-day.repository.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageFact,
  type NurturingProjectUsageState,
} from "../rules/nurturing-project-usage.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";
import {
  emptyTraceDay,
  foldTraceDay,
  type NurturingTraceDayState,
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
 * Every fold here is keyed across many owner aggregates (a project, or a project's day): a re-fold
 * loads one aggregate's log, so it would rebuild the row from that one alone. Their applies
 * commute (sets, sums, maxima), so an event older than the row's newest is folded on as it comes.
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

/** What the trace-day fold reads of a span: whether it is a root, and its status; no body. */
const traceSpanDataSchema = z.object({
  span: spanReceivedEventDataSchema.shape.span.pick({ parentSpanId: true, status: true }),
});

/** OTLP's `STATUS_CODE_ERROR`: the status trace's rollup counts a failed trace by. */
const OTLP_STATUS_CODE_ERROR = 2;

/** trace's span fact, as the trace-day fold reads it. */
export const nurturingTraceDayPeerEvents = [
  { type: SPAN_RECEIVED_EVENT_TYPE, data: traceSpanDataSchema },
] as const;

/** A span fact as the trace-day fold receives it. */
export type NurturingTraceSpanEvent = PeerEvent<typeof nurturingTraceDayPeerEvents>;

/** A root span: one per trace, the only span the trace-day fold counts. */
export function isRootSpan(event: NurturingTraceSpanEvent): boolean {
  return !event.data.span.parentSpanId;
}

/** The row a span counts on: its project (the tenant) and the UTC day it was appended. */
export function traceDayKeyOf(event: NurturingTraceSpanEvent): string {
  return traceDayKey({ projectId: String(event.tenantId), day: utcDayOf(event.createdAt) });
}

/** One project's traces per UTC day: a root span is a trace, as trace's rollup counts it. */
export function nurturingTraceDayPeerFold(
  traceDays: NurturingTraceDayRepository,
): PeerFoldProjectionDeclaration<NurturingTraceDayState, typeof nurturingTraceDayPeerEvents> {
  return {
    events: nurturingTraceDayPeerEvents,
    fold: {
      name: "traceDays",
      version: NURTURING_TRACE_DAY_PROJECTION_VERSION,
      eventTypes: [SPAN_RECEIVED_EVENT_TYPE],
      init: emptyTraceDay,
      apply: (state, event) =>
        foldTraceDay(state, {
          projectId: String(event.tenantId),
          day: utcDayOf(event.createdAt),
          // Still checked: a replay hands apply every span, the enqueue filter only live ones.
          isRoot: isRootSpan(event),
          isError: event.data.span.status.code === OTLP_STATUS_CODE_ERROR,
          appendedAt: event.createdAt,
          occurredAt: event.occurredAt,
        }),
      key: traceDayKeyOf,
      store: traceDays.store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
      // A child span changes no count: it mints no job, so a trace is one job and one write.
      options: { ...KEYED_FOLD_OPTIONS, enqueue: { filter: isRootSpan } },
    },
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

function nurturingProjectUsageHost({
  store,
  traceDays,
  usageChanged,
}: Readonly<{
  store: NurturingProjectUsageRepository;
  traceDays: NurturingTraceDayRepository;
  usageChanged: UsageChanged;
}>) {
  const subscribers = [organizationUsageSubscriber(usageChanged)];
  const traceSync = throttledWindow<Event>({
    makeId: traceSyncKeyOf,
    windowMs: TRACE_USAGE_SYNC_WINDOW_MS,
  });
  return (
    definePipeline({
      name: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
      aggregate: defineAggregate({ type: "nurturing_project_usage_view" }),
    })
      .withEvents([])
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
      .withPeerFoldProjection(nurturingTraceDayPeerFold(traceDays))
      // Throttled, not debounced: an organization tracing without pause still syncs once per
      // window, 15 minutes after the window's first trace, when its spans are folded.
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
  );
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
      traceDays: repositories.traceDays,
      usageChanged: (input) => app.organizationUsageChanged(input),
    }),
});
