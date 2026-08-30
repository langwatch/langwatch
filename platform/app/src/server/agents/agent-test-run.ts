/**
 * "Test agent": one real scenario run against an agent, with nothing saved.
 *
 * The run goes through the same path a suite run takes, the queued event,
 * the execution pool, the child process and the agent's own adapter, but it
 * carries a fixed scenario instead of a row: the user sends "ping", the agent
 * answers, and the run succeeds when the answer arrives. No scenario, run
 * plan or test suite is written, and the batch lands in the project's agent
 * test set, which the results lists leave out.
 *
 * @see specs/agents/agent-test-run.feature
 */

import { generate } from "@langwatch/ksuid";
import type { JsonValue } from "@prisma/client/runtime/client";
import type { PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import {
  AGENT_TEST_SCENARIO_ID,
  agentTestScenarioConfig,
  getAgentTestSetId,
} from "~/server/scenarios/agent-test-scenario";
import {
  createDataPrefetcherDependencies,
  type DataPrefetcherDependencies,
  prefetchScenarioData,
} from "~/server/scenarios/execution/data-prefetcher";
import { type RunActor, withActor } from "~/server/scenarios/run-actor";
import { generateBatchRunId } from "~/server/scenarios/scenario.ids";
import { assertConnectedAgentsRunnable } from "~/server/suites/connected-targets";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { AgentWithFields } from "./agent-fields";
import { AgentNotFoundError, AgentTestRefusedError } from "./errors";

/** The ids a scheduled test run answers with. */
export type AgentTestRunResult = {
  scenarioRunId: string;
  batchRunId: string;
  setId: string;
};

/** What the scheduler reads and writes, so a test can hand it fixtures. */
export interface AgentTestRunDeps {
  readAgent: (params: {
    projectId: string;
    id: string;
  }) => Promise<AgentWithFields | null>;
  users: Pick<PrismaClient, "user">;
  prefetchDeps: () => DataPrefetcherDependencies;
  queueRun: (
    params: Parameters<ReturnType<typeof getApp>["simulations"]["queueRun"]>[0],
  ) => Promise<unknown>;
}

/** The target a test run points at: an agent kind a scenario runs against. */
export type AgentTestTarget = {
  type: "http" | "code" | "workflow" | "connected";
  referenceId: string;
};

/** The target a test run points at, or nothing for a kind no run targets. */
export function agentTestTarget(agent: {
  id: string;
  type: string;
}): AgentTestTarget | null {
  switch (agent.type) {
    case "http":
    case "code":
    case "workflow":
    case "connected":
      return { type: agent.type, referenceId: agent.id };
    default:
      return null;
  }
}

/**
 * Schedules one agent test run and answers with its ids.
 *
 * @throws {AgentNotFoundError} when no such agent is in the project
 * @throws {AgentTestRefusedError} when the agent's kind or configuration
 *   cannot be run
 * @throws {AgentOwnerOnlyError} when the agent is a personal development
 *   agent of someone other than the actor
 */
export async function scheduleAgentTestRun({
  projectId,
  agentId,
  actor,
  deps,
}: {
  projectId: string;
  agentId: string;
  actor: RunActor | undefined;
  deps: AgentTestRunDeps;
}): Promise<AgentTestRunResult> {
  const agent = await deps.readAgent({ projectId, id: agentId });
  if (!agent) throw new AgentNotFoundError();

  const target = agentTestTarget(agent);
  if (!target) {
    throw new AgentTestRefusedError({
      reason: "Only HTTP, code, workflow and connected agents can be tested",
    });
  }

  await assertConnectedAgentsRunnable({
    agents: [
      {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        config: agent.config as JsonValue,
        environment: agent.environment,
        ownerUserId: agent.ownerUserId,
        hostLabel: agent.hostLabel,
        lastSeenAt: agent.lastSeenAt,
        archivedAt: agent.archivedAt,
      },
    ],
    actor,
    users: deps.users,
  });

  const batchRunId = generateBatchRunId();
  const setId = getAgentTestSetId(projectId);

  // The same preparation the worker makes before the child starts, made here
  // first so an agent the run cannot be prepared from is refused before a run
  // exists.
  const prefetch = await prefetchScenarioData({
    context: {
      projectId,
      scenarioId: AGENT_TEST_SCENARIO_ID,
      setId,
      batchRunId,
    },
    target,
    deps: deps.prefetchDeps(),
  });
  if (!prefetch.success) {
    throw new AgentTestRefusedError({ reason: prefetch.error });
  }

  const scenario = agentTestScenarioConfig({ agentName: agent.name });
  const scenarioRunId = generate(KSUID_RESOURCES.SCENARIO_RUN).toString();
  await deps.queueRun({
    tenantId: projectId,
    scenarioRunId,
    scenarioId: AGENT_TEST_SCENARIO_ID,
    batchRunId,
    scenarioSetId: setId,
    name: scenario.name,
    description: scenario.situation,
    metadata: {
      langwatch: {
        targetReferenceId: target.referenceId,
        targetType: target.type,
        agentTest: true,
        ...withActor(actor),
      },
    },
    target,
    occurredAt: Date.now(),
  });

  return { scenarioRunId, batchRunId, setId };
}

/** The scheduler's reads and writes against the running app. */
export function createAgentTestRunDeps({
  prisma,
  readAgent,
}: {
  prisma: PrismaClient;
  readAgent: AgentTestRunDeps["readAgent"];
}): AgentTestRunDeps {
  return {
    readAgent,
    users: prisma,
    prefetchDeps: createDataPrefetcherDependencies,
    queueRun: (params) => getApp().simulations.queueRun(params),
  };
}
