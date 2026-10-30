/**
 * Every top-level key set the previous release stored on an agent, read through this release's
 * config schemas. A key a schema does not know is stripped on read and gone on the next save.
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { buildCodeConfig, codeConfigKeepingStored } from "../code-config.ts";
import { type AgentType, codeAgentConfigSchema, parseAgentConfig } from "../config/index.ts";
import type { Field } from "../fields.ts";

const inputs: Field[] = [{ identifier: "question", type: "str" }];
const outputs: Field[] = [{ identifier: "answer", type: "str" }];
const scenarioMappings = {
  question: { type: "source", sourceId: "scenario", path: ["input"] },
};

/** One stored config per agent type, holding every key the previous release wrote for it. */
const STORED: Record<AgentType, Record<string, unknown>> = {
  code: {
    inputs,
    outputs,
    parameters: [{ identifier: "code", type: "code", value: "class Code: ..." }],
    name: "Code",
    description: "Python code block",
    scenarioMappings,
    timeoutMs: 30_000,
    scenarioOutputField: "answer",
  },
  http: {
    url: "https://agent.test/chat",
    method: "POST",
    bodyTemplate: '{"q": "{{input}}"}',
    outputPath: "$.answer",
    description: "HTTP API endpoint",
    name: "HTTP",
    headers: [{ key: "X-Team", value: "support" }],
    scenarioMappings,
    auth: { type: "bearer", token: "{{ secrets.AGENT_TOKEN }}" },
    timeoutMs: 20_000,
    sessionPath: "$.session",
    devTunnel: { previousUrl: "https://agent.test/chat", connectedAt: "2026-10-01T00:00:00Z" },
    inputs,
  },
  workflow: {
    workflow_id: "workflow_1",
    isCustom: true,
    name: "Support triage",
    workflowFields: {
      inputFields: inputs,
      outputFields: outputs,
      fieldsResolved: true,
      recordedAt: 1,
    },
    scenarioMappings,
    scenarioOutputField: "answer",
    outputs,
    inputs,
    description: "A workflow",
  },
  connected: {
    concurrency: 4,
    parameters: [{ name: "tone", type: "string" }],
    timeoutMs: 60_000,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    sticky: true,
  },
  signature: { prompt: "Answer clearly" },
  voice: {
    transport: "elevenlabs_convai",
    agentId: "agent_voice",
    phoneNumber: "+14155550123",
    isAgentSpeaksFirst: true,
  },
};

describe("given the config key sets the previous release stored", () => {
  for (const type of ["code", "http", "workflow", "connected", "signature"] as const) {
    describe(`when a ${type} agent's config is read`, () => {
      it("keeps every stored key and value", () => {
        expect(parseAgentConfig(type, STORED[type])).toEqual(STORED[type]);
      });
    });
  }

  describe("when a voice agent's config is read", () => {
    it("keeps the transport and agent id, and folds the legacy speaks-first flag", () => {
      // An ElevenLabs agent has no phone number or call direction: those belong to phone agents.
      expect(parseAgentConfig("voice", STORED.voice)).toEqual({
        transport: "elevenlabs_convai",
        agentId: "agent_voice",
      });
    });

    it("keeps a phone agent's number and reads speaks-first as an inbound call", () => {
      expect(
        parseAgentConfig("voice", {
          transport: "phone",
          phoneNumber: "+14155550123",
          isAgentSpeaksFirst: true,
        }),
      ).toEqual({ transport: "phone", phoneNumber: "+14155550123", callDirection: "inbound" });
    });
  });
});

describe("given a stored code agent", () => {
  const stored = codeAgentConfigSchema.parse({
    ...STORED.code,
    _library_ref: "library_1",
    parameters: [
      { identifier: "code", type: "code", value: "class Code: ..." },
      { identifier: "retries", type: "int", value: 2 },
    ],
  });

  describe("when the editor saves it", () => {
    const edited = buildCodeConfig({
      code: "class Code: pass",
      inputs: [{ identifier: "text", type: "str" }],
      outputs,
      scenarioMappings: {},
    });
    const saved = codeConfigKeepingStored({ stored, edited });

    it("writes what the editor changed", () => {
      expect(saved.inputs).toEqual([{ identifier: "text", type: "str" }]);
      expect(saved.parameters[0]).toEqual({
        identifier: "code",
        type: "code",
        value: "class Code: pass",
      });
    });

    it("keeps what the editor does not edit", () => {
      expect(saved.timeoutMs).toBe(30_000);
      expect(saved._library_ref).toBe("library_1");
      expect(saved.parameters).toContainEqual({ identifier: "retries", type: "int", value: 2 });
    });

    it("drops a scenario mapping the editor cleared, rather than restoring the stored one", () => {
      expect(saved).not.toHaveProperty("scenarioMappings");
      expect(saved.scenarioOutputField).toBeUndefined();
    });

    it("still satisfies the code agent schema", () => {
      expect(codeAgentConfigSchema.parse(saved)).toEqual(saved);
    });
  });

  describe("when there is nothing stored yet", () => {
    it("writes the edited config as it is", () => {
      const edited = buildCodeConfig({ code: "x", inputs, outputs });
      expect(codeConfigKeepingStored({ stored: void 0, edited })).toBe(edited);
    });
  });
});
