/**
 * @vitest-environment node
 *
 * An inbound phone voice target: when the callee greets on connect, the run
 * must open with the agent's own turn so the greeting is captured as the first
 * turn, then hand over to the normal simulator/judge loop (`proceed()`), which
 * runs the scenario to its conclusion. Every other target keeps the default
 * cast, which opens with the user simulator.
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
import { buildAgentGreetsFirstScript } from "../../execution/agent-first-script";
import type { TargetAdapterData } from "../../execution/types";

/** A phone voice target's prefetched data, inbound (greets on connect) or outbound. */
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

describe("buildAgentGreetsFirstScript", () => {
  describe("given an inbound phone target whose agent greets on connect", () => {
    /** @scenario "An inbound agent that greets on connect opens the call" */
    it("opens with the greeting, then the caller's reply and the agent's response, before proceeding", async () => {
      const script = buildAgentGreetsFirstScript(phoneVoiceData("inbound"));

      // The run opens with the agent's greeting, the caller's reply and the
      // agent's response — all scheduled explicitly — before handing over.
      expect(script).toBeDefined();
      expect(script).toHaveLength(4);

      const { calls, executor } = fakeExecutor();
      for (const step of script!) {
        await step({} as never, executor as never);
      }

      // Greeting, caller reply, agent response, then the normal loop takes
      // over (proceed) — the judge can only be reached after the caller has
      // actually spoken, not on the greeting alone.
      expect(calls).toEqual(["agent", "user", "agent", "proceed"]);
    });
  });

  describe("given an outbound phone target", () => {
    it("keeps the default cast: no agent-first script", () => {
      expect(
        buildAgentGreetsFirstScript(phoneVoiceData("outbound")),
      ).toBeUndefined();
    });
  });

  describe("given an ElevenLabs voice target", () => {
    it("never adds an agent-first script (the behavior is phone-only)", () => {
      expect(
        buildAgentGreetsFirstScript(elevenLabsVoiceData()),
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
      expect(buildAgentGreetsFirstScript(httpData)).toBeUndefined();
    });
  });

  it("uses the SDK's own agent() and proceed() steps", () => {
    // Guards that the builder wires the real SDK helpers (a rename or removal
    // upstream must fail here, not silently produce inert steps).
    expect(typeof ScenarioRunner.agent).toBe("function");
    expect(typeof ScenarioRunner.proceed).toBe("function");
  });
});
