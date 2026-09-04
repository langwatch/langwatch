/**
 * One turn to an agent, answered with what it returned: the Test panel of
 * the agent drawers.
 *
 * The turn walks the path a simulation turn walks. A connected agent is
 * reached through the same dispatcher and instance choice a run uses; an
 * HTTP, code or workflow agent through the same adapter the scenario child
 * builds from the same prepared data. What a person sees here is what a run
 * will see: the same request, the same rendering, the same handled errors.
 *
 * @see specs/agents/agent-test-run.feature
 */

import type { AgentInput } from "@langwatch/scenario";
import { AgentRole } from "@langwatch/scenario";
import type { PrismaClient } from "~/generated/prisma/client";
import type { ConnectedComponentConfig } from "~/optimization_studio/types/dsl";
import {
  DEFAULT_CALL_TIMEOUT_MS,
  MAX_CALL_TIMEOUT_MS,
} from "~/server/connected-agents/constants";
import { AgentCallTimeoutError } from "~/server/connected-agents/errors";
import { getConnectedAgentRuntime } from "~/server/connected-agents/runtime";
import {
  AGENT_TEST_SCENARIO_ID,
  getAgentTestSetId,
} from "~/server/scenarios/agent-test-scenario";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "~/server/scenarios/execution/data-prefetcher";
import { createAdapter } from "~/server/scenarios/execution/serialized-adapter.registry";
import type { RunActor } from "~/server/scenarios/run-actor";
import { assertConnectedAgentsRunnable } from "~/server/suites/connected-targets";
import type { AgentWithFields } from "./agent-fields";
import { agentTestTarget } from "./agent-test-run";
import { AgentNotFoundError, AgentTestRefusedError } from "./errors";

/** What one turn answered. */
export type AgentTestTurnResult = {
  output: unknown;
  durationMs: number;
  /** The connected agent instance that answered; null for the other kinds. */
  instance: { hostname: string; label: string | null } | null;
};

/** The reads a turn makes, so a test can hand it fixtures. */
export interface AgentTestTurnDeps {
  readAgent: (params: {
    projectId: string;
    id: string;
  }) => Promise<AgentWithFields | null>;
  users: Pick<PrismaClient, "user">;
}

/**
 * The input of a single turn, as the adapters read it: the conversation is
 * the one message, and the thread is new. The adapters read the messages and
 * the thread id and nothing else of the run's state.
 */
function oneTurnInput({
  threadId,
  message,
}: {
  threadId: string;
  message: string;
}): AgentInput {
  const userMessage = { role: "user" as const, content: message };
  return {
    threadId,
    messages: [userMessage],
    newMessages: [userMessage],
    requestedRole: AgentRole.AGENT,
    scenarioState: {} as AgentInput["scenarioState"],
    scenarioConfig: {} as AgentInput["scenarioConfig"],
  };
}

/**
 * The ceiling every kind of agent answers inside, the same one the connected
 * path clamps its call budget to. An adapter carries a timeout of its own,
 * and an HTTP agent carries none at all, so without this a turn could park
 * the request for as long as the agent takes. The adapters take no signal,
 * so the work continues in the background and its answer is dropped.
 */
async function withinCallDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void work.catch(() => undefined);
          reject(new AgentCallTimeoutError({ timeoutMs: MAX_CALL_TIMEOUT_MS }));
        }, MAX_CALL_TIMEOUT_MS);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Sends one turn to a connected agent, through the dispatcher and the
 * instance choice a run uses, and answers what the instance returned.
 */
async function dispatchConnectedTurn({
  projectId,
  agent,
  message,
  params,
}: {
  projectId: string;
  agent: AgentWithFields;
  message: string;
  params?: Record<string, string | number | boolean>;
}): Promise<AgentTestTurnResult> {
  const config = agent.config as ConnectedComponentConfig;
  const messages = [{ role: "user" as const, content: message }];
  const outcome = await getConnectedAgentRuntime().dispatcher.dispatch({
    projectId,
    agent: {
      id: agent.id,
      name: agent.name,
      environment: agent.environment,
      timeoutMs: Math.min(
        config.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS,
        MAX_CALL_TIMEOUT_MS,
      ),
      isSticky: config.sticky ?? false,
    },
    call: {
      threadId: crypto.randomUUID(),
      messages,
      newMessages: messages,
      params: params ?? {},
      session: undefined,
      traceparent: null,
      run: {},
    },
  });
  return {
    output: outcome.output,
    durationMs: outcome.durationMs,
    instance: {
      hostname: outcome.instance.hostname,
      label: outcome.instance.label,
    },
  };
}

/**
 * Sends one turn to the agent and answers what it returned.
 *
 * @throws {AgentNotFoundError} when no such agent is in the project
 * @throws {AgentTestRefusedError} when the agent cannot be run as it is
 * @throws {AgentOwnerOnlyError} when the agent belongs to someone else
 */
export async function sendAgentTestTurn({
  projectId,
  agentId,
  message,
  params,
  actor,
  deps,
}: {
  projectId: string;
  agentId: string;
  message: string;
  params?: Record<string, string | number | boolean>;
  actor: RunActor | undefined;
  deps: AgentTestTurnDeps;
}): Promise<AgentTestTurnResult> {
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
        ownerUserId: agent.ownerUserId,
      },
    ],
    actor,
    users: deps.users,
  });

  if (agent.type === "connected") {
    return await dispatchConnectedTurn({ projectId, agent, message, params });
  }

  // The same prepared data the scenario child receives, and the same adapter
  // it builds from it. The batch id is a placeholder: nothing is queued.
  const prefetch = await prefetchScenarioData({
    context: {
      projectId,
      scenarioId: AGENT_TEST_SCENARIO_ID,
      setId: getAgentTestSetId(projectId),
      batchRunId: "agent-test-turn",
    },
    target,
    deps: createDataPrefetcherDependencies(),
  });
  if (!prefetch.success) {
    throw new AgentTestRefusedError({ reason: prefetch.error });
  }

  const adapter = createAdapter({
    adapterData: prefetch.data.adapterData,
    nlpServiceUrl: prefetch.data.nlpServiceUrl,
    projectApiKey: prefetch.telemetry.apiKey,
    parameters: params ?? {},
  });
  const startedAt = Date.now();
  const output = await withinCallDeadline(
    adapter.call(oneTurnInput({ threadId: crypto.randomUUID(), message })),
  );
  return { output, durationMs: Date.now() - startedAt, instance: null };
}
