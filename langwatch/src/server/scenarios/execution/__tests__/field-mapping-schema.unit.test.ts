/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest";
import { suiteTargetSchema } from "~/server/suites/types";
import { CodeAgentDataSchema, ChildProcessJobDataSchema, TargetConfigSchema } from "../types";

describe("CodeAgentDataSchema", () => {
  describe("when scenarioOutputField is provided", () => {
    it("validates and preserves scenarioOutputField", () => {
      const result = CodeAgentDataSchema.safeParse({
        type: "code",
        agentId: "agent_1",
        code: "def execute(x): return x",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [
          { identifier: "answer", type: "str" },
          { identifier: "context", type: "str" },
        ],
        scenarioOutputField: "answer",
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioOutputField).toBe("answer");
      }
    });
  });

  describe("when scenarioOutputField is omitted", () => {
    it("validates successfully with scenarioOutputField as undefined", () => {
      const result = CodeAgentDataSchema.safeParse({
        type: "code",
        agentId: "agent_1",
        code: "def execute(x): return x",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.scenarioOutputField).toBeUndefined();
      }
    });
  });
});

describe("suiteTargetSchema", () => {
  describe("when type is code with a referenceId", () => {
    it("validates successfully", () => {
      const result = suiteTargetSchema.safeParse({
        type: "code",
        referenceId: "agent_123",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("when only type and referenceId are provided", () => {
    it("validates successfully without fieldMappings", () => {
      const result = suiteTargetSchema.safeParse({
        type: "prompt",
        referenceId: "prompt_456",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("when extra fields are present", () => {
    it("strips unknown fields per Zod default behavior", () => {
      const result = suiteTargetSchema.safeParse({
        type: "http",
        referenceId: "agent_789",
        unknownField: "should be stripped",
      });

      expect(result.success).toBe(true);
    });
  });
});

describe("TargetConfigSchema", () => {
  describe("when only type and referenceId are provided", () => {
    it("validates successfully", () => {
      const result = TargetConfigSchema.safeParse({
        type: "http",
        referenceId: "agent_http_1",
      });

      expect(result.success).toBe(true);
    });
  });

  describe("when all valid target types are used", () => {
    it("accepts prompt type", () => {
      expect(TargetConfigSchema.safeParse({ type: "prompt", referenceId: "p1" }).success).toBe(true);
    });

    it("accepts http type", () => {
      expect(TargetConfigSchema.safeParse({ type: "http", referenceId: "h1" }).success).toBe(true);
    });

    it("accepts code type", () => {
      expect(TargetConfigSchema.safeParse({ type: "code", referenceId: "c1" }).success).toBe(true);
    });
  });
});

describe("ChildProcessJobDataSchema", () => {
  describe("when scenarioMappings are on adapterData", () => {
    it("validates and preserves scenarioMappings in parsed output", () => {
      const payload = {
        context: {
          projectId: "proj_1",
          scenarioId: "scen_1",
          setId: "set_1",
          batchRunId: "batch_1",
        },
        scenario: {
          id: "scen_1",
          name: "Test",
          situation: "A situation",
          criteria: [],
          labels: [],
        },
        adapterData: {
          type: "code",
          agentId: "agent_1",
          code: "def execute(x): return x",
          inputs: [{ identifier: "query", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          scenarioMappings: {
            query: { type: "source", sourceId: "scenario", path: ["scenario_message"] },
          },
        },
        modelParams: {
          api_key: "key",
          model: "openai/gpt-5-mini",
        },
        nlpServiceUrl: "http://localhost:8080",
        target: { type: "code", referenceId: "agent_1" },
      };

      const result = ChildProcessJobDataSchema.safeParse(payload);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.adapterData.type).toBe("code");
        if (result.data.adapterData.type === "code") {
          expect(result.data.adapterData.scenarioMappings).toEqual(
            payload.adapterData.scenarioMappings,
          );
        }
      }
    });
  });

  describe("when scenarioMappings are on HttpAgentData", () => {
    it("validates and preserves scenarioMappings in parsed output", () => {
      const payload = {
        context: {
          projectId: "proj_1",
          scenarioId: "scen_1",
          setId: "set_1",
          batchRunId: "batch_1",
        },
        scenario: {
          id: "scen_1",
          name: "Test",
          situation: "A situation",
          criteria: [],
          labels: [],
        },
        adapterData: {
          type: "http",
          agentId: "agent_1",
          url: "https://api.example.com",
          method: "POST",
          headers: [],
          scenarioMappings: {
            input: { type: "source", sourceId: "scenario", path: ["scenario_message"] },
          },
        },
        modelParams: {
          api_key: "key",
          model: "openai/gpt-5-mini",
        },
        nlpServiceUrl: "http://localhost:8080",
        target: { type: "http", referenceId: "agent_1" },
      };

      const result = ChildProcessJobDataSchema.safeParse(payload);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.adapterData.type).toBe("http");
        if (result.data.adapterData.type === "http") {
          expect(result.data.adapterData.scenarioMappings).toEqual(
            payload.adapterData.scenarioMappings,
          );
        }
      }
    });
  });
});
