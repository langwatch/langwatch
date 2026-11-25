/**
 * @vitest-environment node
 * @see specs/agents/agent-test-run.feature
 */
import { createLogger } from "@langwatch/observability";
import { AgentAdapter, AgentRole, type AgentInput } from "@langwatch/scenario";
import { AgentTestTurnJobSchema } from "@langwatch/scenario-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAgentTestTurn } from "../agent-test-turn.service.ts";
import type { ScenarioChildRuntime } from "../scenario-child-execution.service.ts";

/** An agent the test controls: the voice builder is the one seam that hands back any adapter. */
class ScriptedAgent extends AgentAdapter {
  role = AgentRole.AGENT;
  readonly inputs: AgentInput[] = [];

  constructor(private readonly answer: (input: AgentInput) => Promise<string>) {
    super();
  }

  call(input: AgentInput): Promise<string> {
    this.inputs.push(input);
    return this.answer(input);
  }
}

function runtimeFor(agent: AgentAdapter): ScenarioChildRuntime {
  return {
    langwatchEndpoint: "http://app:5560",
    langwatchApiKey: "sk-lw-project",
    verbose: false,
    httpPort: { fetch: () => Promise.reject(new Error("no HTTP in this test")) },
    logger: createLogger("langwatch:scenarios:agent-test-turn:test"),
    voiceAgents: () => agent,
    endVoiceCall: () => Promise.resolve(),
  };
}

const job = AgentTestTurnJobSchema.parse({
  kind: "agent-test-turn",
  adapterData: {
    type: "voice",
    agentId: "agent_voice",
    voiceTarget: { transport: "elevenlabs_convai", agentId: "el_1", credential: null },
  },
  executeSyncRoute: { mode: "direct", nlpServiceUrl: "http://langwatch_nlp:5561" },
  message: "ping",
  timeoutMs: 1_000,
  nlpTimeouts: {},
});

afterEach(() => {
  vi.useRealTimers();
});

describe("runAgentTestTurn", () => {
  describe("given an agent that answers inside the deadline", () => {
    it("answers its output, sent the one user message on a new thread", async () => {
      const agent = new ScriptedAgent(() => Promise.resolve("pong"));

      const answer = await runAgentTestTurn({ job, runtime: runtimeFor(agent) });

      expect(answer).toMatchObject({ success: true, output: "pong" });
      expect(agent.inputs[0]?.messages).toEqual([{ role: "user", content: "ping" }]);
      expect(agent.inputs[0]?.newMessages).toEqual([{ role: "user", content: "ping" }]);
      expect(agent.inputs[0]?.scenarioState.lastUserMessage()).toMatchObject({ content: "ping" });
      expect(agent.inputs[0]?.scenarioConfig.agents).toEqual([agent]);
    });
  });

  describe("given an agent that never answers", () => {
    /** @scenario "A turn that outlives the call deadline is failed" */
    it("answers a failure naming the deadline once it passes", async () => {
      vi.useFakeTimers();
      const agent = new ScriptedAgent(() => new Promise(() => undefined));

      const pending = runAgentTestTurn({ job, runtime: runtimeFor(agent) });
      await vi.advanceTimersByTimeAsync(1_010);

      await expect(pending).resolves.toMatchObject({ success: false, timeoutMs: 1_000 });
    });
  });
});
