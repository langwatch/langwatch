// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Nurturing's own per-project usage: a peer fold (§9) over the owners' prompt, evaluator, scenario
 * and trace events, keyed by project. Its subscriber places the project in its organization, sums
 * the organization's projects and sends their traits to Customer.io as one group call.
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
import type { NurturingRepositories } from "../repositories/nurturing.repositories.ts";
import {
  emptyProjectUsage,
  foldProjectUsage,
  type NurturingProjectUsageFact,
  type NurturingProjectUsageState,
} from "../rules/nurturing-project-usage.rules.ts";
import {
  NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
  type NurturingProjectUsageRepository,
} from "../repositories/nurturing-project-usage.repository.ts";

/** Hosts nurturing's peer fold over the owners' usage facts; it records no event of its own. */
export const NURTURING_PROJECT_USAGE_PIPELINE_NAME = "nurturing_project_usage" as const;

/** The fold's name; its global lane is `nurturing_project_usage.projectUsage`. */
export const NURTURING_PROJECT_USAGE_PROJECTION_NAME = "projectUsage" as const;

/** A burst of a project's facts collapses into one group call per this delay. */
const USAGE_SYNC_DELAY_MS = 60_000;

/** Every owner fact the fold takes, each parsed by its owner contract's own schema. */
export const nurturingProjectUsagePeerEvents = [
  { type: PROMPT_CREATED_EVENT_TYPE, data: promptCreatedEventDataSchema },
  { type: PROMPT_DELETED_EVENT_TYPE, data: promptDeletedEventDataSchema },
  { type: EVALUATOR_CREATED_EVENT_TYPE, data: evaluatorCreatedEventDataSchema },
  { type: EVALUATOR_DELETED_EVENT_TYPE, data: evaluatorDeletedEventDataSchema },
  { type: SCENARIO_CREATED_EVENT_TYPE, data: scenarioCreatedEventDataSchema },
  { type: SIMULATION_RUN_EVENT_TYPES.FINISHED, data: simulationRunFinishedEventDataSchema },
  { type: TRACE_RECEIVED_EVENT_TYPE, data: traceReceivedEventDataSchema },
] as const;

type ProjectUsagePeerEvent = PeerEvent<typeof nurturingProjectUsagePeerEvents>;

/** The project a fact is about: its data's project, else its tenant (a project for these owners). */
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

/** The peer fold nurturing hosts on its own pipeline, over its own store, one row per project. */
export function nurturingProjectUsagePeerFold(
  store: NurturingProjectUsageRepository,
): PeerFoldProjectionDeclaration<
  NurturingProjectUsageState,
  typeof nurturingProjectUsagePeerEvents
> {
  return {
    events: nurturingProjectUsagePeerEvents,
    fold: {
      name: NURTURING_PROJECT_USAGE_PROJECTION_NAME,
      version: NURTURING_PROJECT_USAGE_PROJECTION_VERSION,
      eventTypes: nurturingProjectUsagePeerEvents.map(({ type }) => type),
      init: () => emptyProjectUsage(""),
      apply: (state, event) =>
        foldProjectUsage(
          state.projectId === "" ? { ...state, projectId: projectIdOf(event) } : state,
          projectUsageFactOf(event),
        ),
      key: projectIdOf,
      store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
    },
  };
}

function nurturingProjectUsageHost({
  store,
  usageChanged,
}: Readonly<{
  store: NurturingProjectUsageRepository;
  usageChanged: (state: NurturingProjectUsageState) => Promise<void>;
}>) {
  const subscriber: PeerFoldSubscriberSpec<NurturingProjectUsageState> = {
    name: "organizationUsage",
    delay: USAGE_SYNC_DELAY_MS,
    dedup: "aggregate",
    handler: (_event, { state }) => usageChanged(state),
  };
  return definePipeline({
    name: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "nurturing_project_usage_view" }),
  })
    .withEvents([])
    .withPeerFoldProjection(nurturingProjectUsagePeerFold(store), [subscriber]);
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
