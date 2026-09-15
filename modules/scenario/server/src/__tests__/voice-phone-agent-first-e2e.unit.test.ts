/**
 * @vitest-environment node
 * @see specs/features/agents/voice-phone.feature
 * "Agent speaks first": a phone target that greets on connect opens with the
 * agent's own turn, captured as turn one, before the normal simulator loop.
 */

import * as ScenarioRunner from "@langwatch/scenario";
import type { TargetAdapterData } from "@langwatch/scenario-contract";
import { describe, expect, it, vi } from "vitest";
import { buildIsAgentSpeaksFirstScript } from "../agent-first-script.ts";

/** A phone voice target's prefetched data, greeting on connect or not. */
function phoneVoiceData(isAgentSpeaksFirst: boolean): TargetAdapterData {
  return {
    type: "voice",
    agentId: "agent_row_1",
    voiceTarget: {
      transport: "phone",
      agentId: "+14155550123",
      credential: null,
      isAgentSpeaksFirst,
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

describe("buildIsAgentSpeaksFirstScript", () => {
  describe('given a phone target whose agent greets on connect and "Agent speaks first" is on', () => {
    /** @scenario "A callee that greets on connect opens the call when Agent speaks first is on" */
    it("opens the run with the agent's turn, then proceeds to the simulator/judge loop", async () => {
      const script = buildIsAgentSpeaksFirstScript(phoneVoiceData(true));

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
        buildIsAgentSpeaksFirstScript(phoneVoiceData(false)),
      ).toBeUndefined();
    });
  });

  describe("given an ElevenLabs voice target", () => {
    it("never adds an agent-first script (the behavior is phone-only)", () => {
      expect(
        buildIsAgentSpeaksFirstScript(elevenLabsVoiceData()),
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
      expect(buildIsAgentSpeaksFirstScript(httpData)).toBeUndefined();
    });
  });

  it("uses the SDK's own agent() and proceed() steps", () => {
    // Guards that the builder wires the real SDK helpers (a rename or removal
    // upstream must fail here, not silently produce inert steps).
    expect(typeof ScenarioRunner.agent).toBe("function");
    expect(typeof ScenarioRunner.proceed).toBe("function");
  });
});
