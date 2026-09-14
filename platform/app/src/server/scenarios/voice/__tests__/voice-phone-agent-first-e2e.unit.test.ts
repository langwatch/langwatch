/**
 * @vitest-environment node
 *
 * "Agent speaks first" for a phone voice target: when the callee greets on
 * connect, the run must open with the agent's own turn so the greeting is
 * captured as the first turn, then hand over to the normal simulator/judge
 * loop (`proceed()`), which runs the scenario to its conclusion. Every other
 * target keeps the default cast, which opens with the user simulator.
 *
 * This drives the real script builder and EXECUTES the produced steps against
 * a recording executor — the same way the SDK's own runner invokes them — so
 * the assertion is on runtime behavior (which turn is asked for, in what
 * order), not on the shape of opaque step functions.
 *
 * @see specs/features/agents/voice-phone.feature
 */

import * as ScenarioRunner from "@langwatch/scenario";
import { describe, expect, it, vi } from "vitest";
import { buildAgentSpeaksFirstScript } from "../../execution/agent-first-script";
import type { TargetAdapterData } from "../../execution/types";

/** A phone voice target's prefetched data, greeting on connect or not. */
function phoneVoiceData(agentSpeaksFirst: boolean): TargetAdapterData {
  return {
    type: "voice",
    agentId: "agent_row_1",
    voiceTarget: {
      transport: "phone",
      agentId: "+14155550123",
      credential: null,
      agentSpeaksFirst,
    },
    callerEnv: {},
    maxCallSeconds: 300,
  };
}

/** An ElevenLabs voice target, which the agent-first behavior never applies to. */
function elevenLabsVoiceData(): TargetAdapterData {
  return {
    type: "voice",
    agentId: "agent_row_2",
    voiceTarget: {
      transport: "elevenlabs_convai",
      agentId: "el_agent",
      credential: null,
    },
    callerEnv: {},
    maxCallSeconds: 300,
  };
}

/** A runner that records what each script step asked of it, in order. */
function fakeExecutor() {
  const calls: string[] = [];
  const executor = {
    agent: vi.fn(async () => {
      calls.push("agent");
    }),
    user: vi.fn(async () => {
      calls.push("user");
    }),
    proceed: vi.fn(async () => {
      calls.push("proceed");
      return null;
    }),
    judge: vi.fn(async () => {
      calls.push("judge");
    }),
    succeed: vi.fn(async () => {
      calls.push("succeed");
    }),
  };
  return { calls, executor };
}

describe("buildAgentSpeaksFirstScript", () => {
  describe('given a phone target whose agent greets on connect and "Agent speaks first" is on', () => {
    /** @scenario "A callee that greets on connect opens the call when Agent speaks first is on" */
    it("opens the run with the agent's turn, then proceeds to the simulator/judge loop", async () => {
      const script = buildAgentSpeaksFirstScript(phoneVoiceData(true));

      // The run opens with the agent's greeting turn, then hands over.
      expect(script).toBeDefined();
      expect(script).toHaveLength(2);

      const { calls, executor } = fakeExecutor();
      for (const step of script!) {
        await step({} as never, executor as never);
      }

      // First the callee greets (agent turn), then the normal loop runs to a
      // conclusion (proceed) — so the caller replies only after the greeting.
      expect(calls).toEqual(["agent", "proceed"]);
    });
  });

  describe('given a phone target with "Agent speaks first" off', () => {
    it("keeps the default cast: no agent-first script", () => {
      expect(
        buildAgentSpeaksFirstScript(phoneVoiceData(false)),
      ).toBeUndefined();
    });
  });

  describe("given an ElevenLabs voice target", () => {
    it("never adds an agent-first script (the behavior is phone-only)", () => {
      expect(
        buildAgentSpeaksFirstScript(elevenLabsVoiceData()),
      ).toBeUndefined();
    });
  });

  describe("given a non-voice target", () => {
    it("never adds an agent-first script", () => {
      const httpData: TargetAdapterData = {
        type: "http",
        agentId: "http_agent",
        url: "https://example.test/agent",
        method: "POST",
        headers: [],
        secrets: {},
      };
      expect(buildAgentSpeaksFirstScript(httpData)).toBeUndefined();
    });
  });

  it("uses the SDK's own agent() and proceed() steps", () => {
    // Guards that the builder wires the real SDK helpers (a rename or removal
    // upstream must fail here, not silently produce inert steps).
    expect(typeof ScenarioRunner.agent).toBe("function");
    expect(typeof ScenarioRunner.proceed).toBe("function");
  });
});
