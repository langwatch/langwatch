/**
 * @vitest-environment node
 *
 * Runs `buildIsAgentSpeaksFirstScript`'s cast through the real SDK runtime
 * (`ScenarioExecution`), not a mocked executor. A mocked-executor test can
 * only see that the cast calls `agent()` then `proceed()` — it cannot see
 * what the runtime's role queue does with that call. This test uses fake,
 * in-process user/agent/judge adapters and an EAGER judge that returns a
 * verdict the instant it is asked, so a scheduling bug (the judge reached
 * before the caller has spoken) is caught by ORDER, not by mocked calls.
 *
 * Regression for review comment 4002987428 on PR #8121: `[agent(), proceed()]`
 * left the runtime's role queue past AGENT, so the following `proceed()`
 * found the agent already spent for the turn and landed straight on JUDGE —
 * an eager judge could conclude the run on the greeting alone.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import { describe, expect, it } from "vitest";
import { buildAgentGreetsFirstScript } from "../agent-first-script";
import type { TargetAdapterData } from "../types";

/** A phone voice target, inbound (greets on connect) or outbound. */
function phoneVoiceData(
  callDirection: "inbound" | "outbound",
): TargetAdapterData {
  return {
    type: "voice",
    agentId: "agent_row_1",
    voiceTarget: {
      transport: "phone",
      agentId: "+14155550123",
      credential: null,
      callDirection,
    },
    callerEnv: {},
    maxCallSeconds: 300,
  };
}

/** The agent under test: answers every turn it is asked for, in order. */
class FakeAgent extends ScenarioRunner.AgentAdapter {
  name = "FakeAgent";
  role = ScenarioRunner.AgentRole.AGENT;
  #replies: string[];
  #calls: string[];
  constructor(replies: string[], calls: string[]) {
    super();
    this.#replies = replies;
    this.#calls = calls;
  }
  async call() {
    this.#calls.push("agent");
    const reply = this.#replies.shift();
    if (reply === undefined) throw new Error("FakeAgent has no more lines");
    return reply;
  }
}

/** The caller: answers with its one written line. */
class FakeUser extends ScenarioRunner.UserSimulatorAgentAdapter {
  name = "FakeUser";
  role = ScenarioRunner.AgentRole.USER;
  #calls: string[];
  constructor(calls: string[]) {
    super();
    this.#calls = calls;
  }
  async call() {
    this.#calls.push("user");
    return "Hi, is this the pharmacy?";
  }
}

/**
 * A judge that renders a verdict the instant it is asked, ignoring
 * `minTurns` — the same shortcut a real early-exit judge takes. Its
 * `success` field is what the runtime reads to treat the call as a final
 * result rather than another conversational turn.
 */
class EagerJudge extends ScenarioRunner.JudgeAgentAdapter {
  name = "EagerJudge";
  role = ScenarioRunner.AgentRole.JUDGE;
  criteria = ["the agent greets the caller"];
  #calls: string[];
  constructor(calls: string[]) {
    super();
    this.#calls = calls;
  }
  async call() {
    this.#calls.push("judge");
    return {
      success: true,
      reasoning: "eager verdict",
      metCriteria: this.criteria,
      unmetCriteria: [],
    };
  }
}

/** Runs the cast through the real runtime and returns the call order. */
async function runCast(script: ScenarioRunner.ScriptStep[] | undefined) {
  const calls: string[] = [];
  const agents: ScenarioRunner.AgentAdapter[] = [
    new FakeAgent(["Hello, thanks for calling.", "Sure, one moment."], calls),
    new FakeUser(calls),
    new EagerJudge(calls),
  ];
  const execution = new ScenarioRunner.ScenarioExecution(
    {
      name: "agent-first turn order",
      description: "regression for review comment 4002987428",
      agents,
      ...(script ? { script } : {}),
    },
    script ?? [ScenarioRunner.proceed()],
    "batch_test",
  );
  const result = await execution.execute();
  return { calls, result };
}

describe("agent-first cast against the real runtime", () => {
  describe("given an inbound phone target whose agent greets first", () => {
    it("runs agent, then user, then agent, before the first verdict", async () => {
      const script = buildAgentGreetsFirstScript(phoneVoiceData("inbound"));
      const { calls, result } = await runCast(script);

      expect(calls).toEqual(["agent", "user", "agent", "judge"]);
      expect(result.success).toBe(true);
    });
  });

  describe("given an outbound phone target", () => {
    it("keeps the default order: user, then agent, then judge", async () => {
      const script = buildAgentGreetsFirstScript(phoneVoiceData("outbound"));
      expect(script).toBeUndefined();

      const { calls, result } = await runCast(script);

      expect(calls).toEqual(["user", "agent", "judge"]);
      expect(result.success).toBe(true);
    });
  });
});
