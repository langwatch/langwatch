// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's own per-project usage: peer folds (§9) over the owners' prompt, evaluator, scenario,
 * simulation-run and trace events, keyed by project. A peer fold re-folds from one owner's event
 * log, so there is one fold per owner pipeline, each with its own row per project. Each fold's
 * subscriber places the project in its organization, sums every row of the organization and sends
 * the traits to Customer.io as one group call.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type PeerEvent,
  type PeerFoldProjectionDeclaration,
  type PeerFoldSubscriberSpec,
} from "@langwatch/eventing";
import {
  EVALUATOR_CREATED_EVENT_TYPE,
  EVALUATOR_DELETED_EVENT_TYPE,
  evaluatorCreatedEventDataSchema,
  evaluatorDeletedEventDataSchema,
} from "@langwatch/evaluator-contract";
import {
  PROMPT_CREATED_EVENT_TYPE,
  PROMPT_DELETED_EVENT_TYPE,
  promptCreatedEventDataSchema,
  promptDeletedEventDataSchema,
} from "@langwatch/prompt-contract";
import {
  SCENARIO_CREATED_EVENT_TYPE,
  SIMULATION_RUN_EVENT_TYPES,
  scenarioCreatedEventDataSchema,
  simulationRunFinishedEventDataSchema,
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

/** Hosts nurturing's peer folds over the owners' usage facts; it records no event of its own. */
export const NURTURING_PROJECT_USAGE_PIPELINE_NAME = "nurturing_project_usage" as const;

/** A burst of a project's facts collapses into one group call per owner per this window. */
const USAGE_SYNC_DELAY_MS = 60_000;

/** Each owner pipeline's facts, each parsed by its owner contract's own schema. */
export const nurturingProjectUsagePeerEvents = {
  prompt: [
    { type: PROMPT_CREATED_EVENT_TYPE, data: promptCreatedEventDataSchema },
    { type: PROMPT_DELETED_EVENT_TYPE, data: promptDeletedEventDataSchema },
  ],
  evaluator: [
    { type: EVALUATOR_CREATED_EVENT_TYPE, data: evaluatorCreatedEventDataSchema },
    { type: EVALUATOR_DELETED_EVENT_TYPE, data: evaluatorDeletedEventDataSchema },
  ],
  scenario: [{ type: SCENARIO_CREATED_EVENT_TYPE, data: scenarioCreatedEventDataSchema }],
  simulation: [
    { type: SIMULATION_RUN_EVENT_TYPES.FINISHED, data: simulationRunFinishedEventDataSchema },
  ],
  trace: [{ type: TRACE_RECEIVED_EVENT_TYPE, data: traceReceivedEventDataSchema }],
} as const satisfies Record<NurturingProjectUsageOwner, readonly unknown[]>;

type AllPeerEvents = (typeof nurturingProjectUsagePeerEvents)[NurturingProjectUsageOwner];
type ProjectUsagePeerEvent = PeerEvent<AllPeerEvents>;

/** The project a fact is about: its data's project, else its tenant (a project here). */
export function projectIdOf(event: ProjectUsagePeerEvent): string {
  return "projectId" in event.data && typeof event.data.projectId === "string"
    ? event.data.projectId
    : String(event.tenantId);
}

/** The owner fact as the fold counts it. */
export function projectUsageFactOf(event: ProjectUsagePeerEvent): NurturingProjectUsageFact {
  const { occurredAt } = event;
  switch (event.type) {
    case PROMPT_CREATED_EVENT_TYPE:
      return { kind: "prompt_created", promptId: event.data.promptId, occurredAt };
    case PROMPT_DELETED_EVENT_TYPE:
      return { kind: "prompt_deleted", promptId: event.data.promptId, occurredAt };
    case EVALUATOR_CREATED_EVENT_TYPE:
      return { kind: "evaluator_created", evaluatorId: event.data.evaluatorId, occurredAt };
    case EVALUATOR_DELETED_EVENT_TYPE:
      return { kind: "evaluator_deleted", evaluatorId: event.data.evaluatorId, occurredAt };
    case SCENARIO_CREATED_EVENT_TYPE:
      return { kind: "scenario_created", scenarioCount: event.data.scenarioCount, occurredAt };
    case SIMULATION_RUN_EVENT_TYPES.FINISHED:
      return { kind: "scenario_run", occurredAt };
    case TRACE_RECEIVED_EVENT_TYPE:
      return {
        kind: "trace_received",
        traceId: event.data.traceId ?? null,
        containsErrorStatus: event.data.containsErrorStatus ?? false,
        totalCost: event.data.totalCost ?? null,
        occurredAt,
      };
  }
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
        const parsed = event as ProjectUsagePeerEvent;
        return foldProjectUsage(
          state.projectId === "" ? { ...state, projectId: projectIdOf(parsed) } : state,
          projectUsageFactOf(parsed),
        );
      },
      key: (event) => projectIdOf(event as ProjectUsagePeerEvent),
      store: store.forOwner(owner),
      LastEventOccurredAtKey: "LastEventOccurredAt",
    },
  };
}

/**
 * Each fold's subscriber: debounced per project, so a burst of one owner's facts sends once. The
 * framework keeps each subscriber's dedup to its own lane, so facts of several owners in the same
 * minute send once per owner; each send is the organization's whole sum, so a repeat is harmless.
 */
function organizationUsageSubscriber(
  usageChanged: (state: NurturingProjectUsageState) => Promise<void>,
): PeerFoldSubscriberSpec<NurturingProjectUsageState> {
  return {
    name: "organizationUsage",
    delay: USAGE_SYNC_DELAY_MS,
    dedup: {
      makeId: (event) => `project:${projectIdOf(event as ProjectUsagePeerEvent)}`,
      ttlMs: USAGE_SYNC_DELAY_MS,
      extend: true,
      replace: true,
    },
    handler: (_event, { state }) => usageChanged(state),
  };
}

function nurturingProjectUsageHost({
  store,
  usageChanged,
}: Readonly<{
  store: NurturingProjectUsageRepository;
  usageChanged: (state: NurturingProjectUsageState) => Promise<void>;
}>) {
  const subscribers = [organizationUsageSubscriber(usageChanged)];
  return definePipeline({
    name: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "nurturing_project_usage_view" }),
  })
    .withEvents([])
    .withPeerFoldProjection(nurturingProjectUsagePeerFold({ owner: "prompt", store }), subscribers)
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
    .withPeerFoldProjection(nurturingProjectUsagePeerFold({ owner: "trace", store }), subscribers);
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
      usageChanged: (state) => app.organizationUsageChanged(state),
    }),
});
