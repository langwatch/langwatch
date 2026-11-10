// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's own per-project usage (§9). Peer folds over the owners' prompt, evaluator, scenario
 * and simulation-run events, keyed by project: a peer fold re-folds from one owner's event log,
 * so there is one fold per owner pipeline, each with its own row per project. Evaluations add at
 * most one active day per project a day to their own row. Traces are not copied: trace's existing
 * trace_received fact, throttled per organization, triggers one read of trace's own rollup. Each
 * fold change syncs the project's organization as one Customer.io group call.
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
import { TRACE_RECEIVED_EVENT_TYPE, traceReceivedEventDataSchema } from "@langwatch/trace-contract";

import type { NurturingModule } from "../app/nurturing.app.ts";
import {
  NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
  type NurturingProjectUsageOwner,
  type NurturingProjectUsageRepository,
} from "../repositories/nurturing-project-usage.repository.ts";
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageFact,
  type NurturingProjectUsageState,
} from "../rules/nurturing-project-usage.rules.ts";
import { utcDayOf } from "../rules/nurturing-time.rules.ts";

/** Hosts nurturing's peer folds and subscribers over the owners' facts; no event of its own. */
export const NURTURING_PROJECT_USAGE_PIPELINE_NAME = "nurturing_project_usage" as const;

/** A burst of a project's facts collapses into one group call per owner per this window. */
const USAGE_SYNC_DELAY_MS = 60_000;

/**
 * Traces sync an organization at most once per this window, however busy it is: each sync is one
 * ClickHouse read of trace's rollup, and the per-email traits need no fresher count than this.
 */
export const TRACE_USAGE_SYNC_WINDOW_MS = 15 * 60_000;

/** A project's evaluations write its day once: later ones the same day would add nothing. */
const EVALUATION_DAY_DEDUP_TTL_MS = 24 * 60 * 60_000;

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
  usageChanged,
  tracesChanged,
}: Readonly<{
  store: NurturingProjectUsageRepository;
  usageChanged: UsageChanged;
  tracesChanged: UsageChanged;
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
      // Throttled, not debounced: an organization tracing without pause still syncs once per
      // window, 15 minutes after the window's first trace, so the read sees the whole window.
      .withPeerSubscriber("traceUsageSync", {
        eventType: TRACE_RECEIVED_EVENT_TYPE,
        data: traceSyncDataSchema,
        options: { delay: traceSync.delay, deduplication: traceSync.dedup },
        handle: (data) => tracesChanged({ projectId: data.projectId }),
      })
      // Evaluations count only as habit days, which a trace sync reads: no sync of their own.
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
      usageChanged: (input) => app.organizationUsageChanged(input),
      tracesChanged: (input) => app.organizationTracesChanged(input),
    }),
});
