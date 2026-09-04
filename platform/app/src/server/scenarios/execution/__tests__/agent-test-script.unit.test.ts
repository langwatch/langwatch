/**
 * @vitest-environment node
 *
 * The scripted conversation of an agent test as the child plays it: who is
 * on the cast, what each step asks the runner to do, and how an agent that
 * cannot answer fails it.
 *
 * @see specs/agents/agent-test-run.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import { describe, expect, it, vi } from "vitest";
import { buildAgentTestRun, ScriptedUserAgent } from "../agent-test-script";
import {
  ConnectedAgentCallError,
  SerializedConnectedAgentAdapter,
} from "../serialized-adapters/connected-agent.adapter";
import type { ConnectedAgentData } from "../types";

class AnsweringAgent extends ScenarioRunner.AgentAdapter {
  role = ScenarioRunner.AgentRole.AGENT;
  async call() {
    return "pong";
  }
}

/** A runner that records what each step asked of it. */
function fakeExecutor() {
  const calls: string[] = [];
  const executor = {
    user: vi.fn(async (content?: string) => {
      calls.push(`user:${content ?? ""}`);
    }),
    agent: vi.fn(async () => {
      calls.push("agent");
    }),
    succeed: vi.fn(async (reasoning?: string) => {
      calls.push(`succeed:${reasoning ?? ""}`);
    }),
  };
  return { calls, executor };
}

describe("buildAgentTestRun", () => {
  describe("when the child builds the cast of a scripted run", () => {
    const adapter = new AnsweringAgent();
    const cast = buildAgentTestRun({
      adapter,
      script: { kind: "agent_test", userMessage: "ping" },
    });

    /** @scenario "The scripted run sends ping and succeeds on the answer" */
    it("writes the user's line, asks the agent under test, then succeeds", async () => {
      const { calls, executor } = fakeExecutor();
      for (const step of cast.script) {
        await step({} as never, executor as never);
      }
      expect(calls).toEqual([
        "user:ping",
        "agent",
        "succeed:The agent answered",
      ]);
    });

    it("puts the agent under test and a user on the cast, and no judge", () => {
      expect(cast.agents).toHaveLength(2);
      expect(cast.agents[0]).toBe(adapter);
      expect(cast.agents[1]?.role).toBe(ScenarioRunner.AgentRole.USER);
      expect(
        cast.agents.some(
          (agent) => agent.role === ScenarioRunner.AgentRole.JUDGE,
        ),
      ).toBe(false);
    });
  });

  describe("when the runner asks the scripted user for a message of its own", () => {
    /** @scenario "The scripted user never improvises" */
    it("refuses", async () => {
      await expect(new ScriptedUserAgent().call()).rejects.toThrow(
        /written down/,
      );
    });
  });

  describe("given a connected agent with no process connected", () => {
    const config: ConnectedAgentData = {
      type: "connected",
      agentId: "agent_connected",
      endpoint: "http://app:5560/",
      timeoutMs: 1_000,
    };

    /** @scenario "An offline connected agent fails the run" */
    it("fails the agent's turn and names it offline", async () => {
      const adapter = new SerializedConnectedAgentAdapter({
        config,
        projectApiKey: "sk-lw-project",
        fetchImpl: async () => {
          const body = { error: "agent_offline", message: "No instance" };
          return {
            ok: false,
            status: 503,
            headers: { get: () => null },
            json: async () => body,
            text: async () => JSON.stringify(body),
          };
        },
        sleep: async () => {},
      });
      const cast = buildAgentTestRun({
        adapter,
        script: { kind: "agent_test", userMessage: "ping" },
      });
      const agentUnderTest = cast.agents[0];
      if (!agentUnderTest) throw new Error("no agent on the cast");
      const message = { role: "user" as const, content: "ping" };

      await expect(
        agentUnderTest.call({
          threadId: "thread_1",
          messages: [message],
          newMessages: [message],
          requestedRole: ScenarioRunner.AgentRole.AGENT,
          scenarioState: {} as never,
          scenarioConfig: {} as never,
        }),
      ).rejects.toMatchObject({
        name: ConnectedAgentCallError.name,
        code: "agent_offline",
      });
    });
  });
});
