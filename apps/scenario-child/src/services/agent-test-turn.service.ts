/**
 * One "test agent" turn in the child: the same adapter a simulation turn uses, called once with
 * the user's message, inside the platform's call deadline.
 * @see specs/agents/agent-test-run.feature
 */

import { generate } from "@langwatch/ksuid";
import {
  AgentRole,
  ScenarioExecutionState,
  type AgentAdapter,
  type AgentInput,
  type ScenarioConfig,
} from "@langwatch/scenario";
import type { AgentTestTurnAnswer, AgentTestTurnJob } from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import { SerializedAgentChannelRegistry } from "../channels/serialized-agent-channels.registry.ts";
import type { ScenarioChildRuntime } from "./scenario-child-execution.service.ts";

/** The input of a single turn, as the adapters read it: a one-message scenario of its own. */
function oneTurnInput({
  threadId,
  message,
  agent,
}: {
  threadId: string;
  message: string;
  agent: AgentAdapter;
}): AgentInput {
  const userMessage = { role: "user" as const, content: message };
  const scenarioConfig: ScenarioConfig = {
    name: "Agent test",
    description: "One test turn: the user's message, sent once to the agent.",
    agents: [agent],
  };
  const scenarioState = new ScenarioExecutionState(scenarioConfig);
  scenarioState.threadId = threadId;
  scenarioState.addMessage(userMessage);

  return {
    threadId,
    messages: [userMessage],
    newMessages: [userMessage],
    requestedRole: AgentRole.AGENT,
    scenarioState,
    scenarioConfig,
  };
}

/** Settles with the call's answer, or `timedOut` once the deadline passes first. */
async function withinCallDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then((value) => ({ timedOut: false as const, value })),
      new Promise<{ timedOut: true }>((resolve) => {
        timer = setTimeout(() => {
          void work.catch(() => undefined);
          resolve({ timedOut: true });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runAgentTestTurnValue({
  job,
  runtime,
}: {
  job: AgentTestTurnJob;
  runtime: ScenarioChildRuntime;
}): Promise<AgentTestTurnAnswer> {
  const adapter = SerializedAgentChannelRegistry.create({
    nlpTimeouts: job.nlpTimeouts,
    voiceAgents: runtime.voiceAgents,
  }).build({
    adapterData: job.adapterData,
    nlpServiceUrl: job.nlpServiceUrl,
    nlpInternalSecret: runtime.nlpInternalSecret,
    projectApiKey: runtime.langwatchApiKey,
    parameters: job.parameters,
    httpPort: runtime.httpPort,
    logger: runtime.logger,
  });
  const startedAt = nowInstant().epochMilliseconds;
  const answer = await withinCallDeadline(
    adapter.call(
      oneTurnInput({
        threadId: generate("scenario").toString(),
        message: job.message,
        agent: adapter,
      }),
    ),
    job.timeoutMs,
  );
  if (answer.timedOut) {
    return {
      success: false,
      error: "The agent did not answer before the call deadline.",
      timeoutMs: job.timeoutMs,
    };
  }

  return {
    success: true,
    output: answer.value,
    durationMs: nowInstant().epochMilliseconds - startedAt,
  };
}

export class AgentTestTurnService {
  static create(): AgentTestTurnService {
    return new AgentTestTurnService();
  }

  private constructor() {}

  static readonly run = runAgentTestTurnValue;
}

export const runAgentTestTurn = AgentTestTurnService.run;
