/**
 * The run dialog offers "Call it myself" for a voice target alone: it resolves
 * a voice-call from the selected agent's transport config, and resolves nothing
 * for an HTTP, Code, Workflow or prompt target, so those flows keep their one
 * Run action unchanged (AC25).
 *
 * @see specs/features/agents/voice-agents-v1.feature
 */

import { describe, expect, it } from "vitest";
import type { RunDialogSubject } from "../run-dialog-types";
import type { RunDialogForm } from "../useRunDialogForm";
import { voiceCallTargetOf } from "../voice-call-target";

const VOICE_AGENT = {
  id: "agent_voice",
  name: "Support line",
  type: "voice" as const,
  config: { transport: "elevenlabs_convai", agentId: "el_123" },
};

const HTTP_AGENT = {
  id: "agent_http",
  name: "HTTP bot",
  type: "http" as const,
  config: { url: "https://example.test" },
};

/** A minimal form: the two fields voiceCallTargetOf reads, cast to the type. */
function form(over: {
  target: RunDialogForm["target"];
  scenarioAgents?: unknown[];
}): Pick<RunDialogForm, "target" | "scenarioAgents"> {
  return {
    target: over.target,
    scenarioAgents: (over.scenarioAgents ?? [
      VOICE_AGENT,
      HTTP_AGENT,
    ]) as RunDialogForm["scenarioAgents"],
  };
}

const CASE_SUBJECT: RunDialogSubject = {
  kind: "case",
  scenarioId: "scenario_1",
  name: "Angry cancellation",
  initialTarget: null,
};

const PLAN_SUBJECT: RunDialogSubject = {
  kind: "plan",
  initialTarget: null,
};

function suiteSubject(scenarioIds: string[]): RunDialogSubject {
  return {
    kind: "suite",
    suiteId: "suite_1",
    name: "Support suite",
    scenarioIds,
    initialTarget: null,
  };
}

describe("voiceCallTargetOf", () => {
  describe("given the selected target is a saved voice agent", () => {
    it("resolves the transport, the agent id and the saved row id", () => {
      const result = voiceCallTargetOf({
        form: form({ target: { type: "voice", id: "agent_voice" } }),
        subject: CASE_SUBJECT,
      });

      expect(result).toEqual({
        transport: "elevenlabs_convai",
        agentId: "el_123",
        agentRowId: "agent_voice",
        scenarioId: "scenario_1",
      });
    });
  });

  describe("given the run dialog runs one scenario", () => {
    it("carries that scenario id so the call is scored under it", () => {
      const result = voiceCallTargetOf({
        form: form({ target: { type: "voice", id: "agent_voice" } }),
        subject: CASE_SUBJECT,
      });
      expect(result?.scenarioId).toBe("scenario_1");
    });
  });

  describe("given the scope is a plan of many scenarios", () => {
    /** @scenario "Call it myself is offered only when one scenario is in scope" */
    it("names no scenario, so Call it myself is not offered for a plan", () => {
      const result = voiceCallTargetOf({
        form: form({ target: { type: "voice", id: "agent_voice" } }),
        subject: PLAN_SUBJECT,
      });
      expect(result).not.toBeNull();
      expect(result?.scenarioId).toBeUndefined();
    });
  });

  describe("given the run dialog runs a suite that holds exactly one scenario", () => {
    /** @scenario "A single-scenario suite scores a Call it myself run under that scenario" */
    it("carries that one scenario id so the call is scored under it", () => {
      const result = voiceCallTargetOf({
        form: form({ target: { type: "voice", id: "agent_voice" } }),
        subject: suiteSubject(["scenario_only"]),
      });
      expect(result?.scenarioId).toBe("scenario_only");
    });
  });

  describe("given the run dialog runs a suite that holds several scenarios", () => {
    /** @scenario "Call it myself is offered only when one scenario is in scope" */
    it("names no scenario, so Call it myself is not offered", () => {
      const result = voiceCallTargetOf({
        form: form({ target: { type: "voice", id: "agent_voice" } }),
        subject: suiteSubject(["scenario_a", "scenario_b"]),
      });
      expect(result).not.toBeNull();
      expect(result?.scenarioId).toBeUndefined();
    });
  });

  describe("given the run dialog runs a suite that holds no scenarios", () => {
    /** @scenario "Call it myself is offered only when one scenario is in scope" */
    it("names no scenario, so Call it myself is not offered", () => {
      const result = voiceCallTargetOf({
        form: form({ target: { type: "voice", id: "agent_voice" } }),
        subject: suiteSubject([]),
      });
      expect(result?.scenarioId).toBeUndefined();
    });
  });

  describe("given the selected target is not a voice agent", () => {
    it("resolves no voice-call, so no Call it myself action is offered", () => {
      expect(
        voiceCallTargetOf({
          form: form({ target: { type: "http", id: "agent_http" } }),
          subject: CASE_SUBJECT,
        }),
      ).toBeNull();
      expect(
        voiceCallTargetOf({
          form: form({ target: { type: "prompt", id: "prompt_1" } }),
          subject: CASE_SUBJECT,
        }),
      ).toBeNull();
      expect(
        voiceCallTargetOf({
          form: form({ target: null }),
          subject: CASE_SUBJECT,
        }),
      ).toBeNull();
    });
  });

  describe("given a voice agent has no usable transport config", () => {
    it("resolves nothing rather than opening a call it cannot mint", () => {
      const result = voiceCallTargetOf({
        form: form({
          target: { type: "voice", id: "agent_voice" },
          scenarioAgents: [
            { id: "agent_voice", name: "x", type: "voice", config: {} },
          ],
        }),
        subject: CASE_SUBJECT,
      });
      expect(result).toBeNull();
    });
  });

  describe("given the agent id exceeds the shared schema's 128-character limit", () => {
    it("resolves nothing rather than opening a call with an id the server would reject", () => {
      const result = voiceCallTargetOf({
        form: form({
          target: { type: "voice", id: "agent_voice" },
          scenarioAgents: [
            {
              id: "agent_voice",
              name: "x",
              type: "voice",
              config: {
                transport: "elevenlabs_convai",
                agentId: "a".repeat(129),
              },
            },
          ],
        }),
        subject: CASE_SUBJECT,
      });
      expect(result).toBeNull();
    });
  });
});
