/* eslint-disable @typescript-eslint/no-empty-function */
import { PromptScope } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  safeOptimizationStudioNodeDataToPromptConfigFormInitialValues,
  versionedPromptToPromptConfigFormValues,
} from "../llmPromptConfigUtils";

describe("safeOptimizationStudioNodeDataToPromptConfigFormInitialValues", () => {
  describe("when LLM value is an object", () => {
    it("preserves the LLM value", () => {
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: {
              model: "gpt-4",
              temperature: 0.7,
              max_tokens: 1000,
            },
          },
        ],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.llm).toEqual({
        model: "gpt-4",
        temperature: 0.7,
        max_tokens: 1000,
      });
    });
  });

  describe("when LLM value is a string (legacy format)", () => {
    it("migrates legacy format to object with model field", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [
          {
            identifier: "llm",
            type: "llm" as const,
            value: "openai/gpt-4-0125-preview",
          },
        ],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.llm).toEqual({
        model: "openai/gpt-4-0125-preview",
      });
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when LLM value is missing", () => {
    it("defaults LLM value to empty object", () => {
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.llm).toEqual({});
    });
  });

  describe("when handle is missing", () => {
    it("defaults handle to null", () => {
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.handle).toBeNull();
    });
  });

  describe("when scope is missing", () => {
    it("defaults scope to PROJECT", () => {
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.scope).toBe(PromptScope.PROJECT);
    });
  });

  describe("when prompt is missing", () => {
    it("defaults prompt to empty string", () => {
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.prompt).toBe("");
    });
  });

  describe("when input identifier is empty string", () => {
    it("generates unique identifier", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [{ identifier: "", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.inputs?.[0]?.identifier).toBe("input");
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when input identifier is undefined", () => {
    it("generates unique identifier", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [{ type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.inputs?.[0]?.identifier).toBe("input");
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when multiple inputs have empty identifiers", () => {
    it("generates unique identifiers for each", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [
          { identifier: "", type: "str" },
          { identifier: "", type: "str" },
          { identifier: "", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.inputs?.[0]?.identifier).toBe("input");
      expect(result.version?.configData?.inputs?.[1]?.identifier).toBe(
        "input_1",
      );
      expect(result.version?.configData?.inputs?.[2]?.identifier).toBe(
        "input_2",
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when output identifier is empty string", () => {
    it("generates unique identifier", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ identifier: "", type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.outputs?.[0]?.identifier).toBe(
        "output",
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when output identifier is undefined", () => {
    it("generates unique identifier", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [{ type: "str" }],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.outputs?.[0]?.identifier).toBe(
        "output",
      );
      consoleWarnSpy.mockRestore();
    });
  });

  describe("when multiple outputs have empty identifiers", () => {
    it("generates unique identifiers for each", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {
          /* this is just a mock implementation for a spy */
        });
      const nodeData = {
        parameters: [],
        inputs: [],
        outputs: [
          { identifier: "", type: "str" },
          { identifier: "", type: "str" },
        ],
      } as any;

      const result =
        safeOptimizationStudioNodeDataToPromptConfigFormInitialValues(nodeData);

      expect(result.version?.configData?.outputs?.[0]?.identifier).toBe(
        "output",
      );
      expect(result.version?.configData?.outputs?.[1]?.identifier).toBe(
        "output_1",
      );
      consoleWarnSpy.mockRestore();
    });
  });
});

describe("versionedPromptToPromptConfigFormValues", () => {
  describe("when prompt handle is empty string", () => {
    it.todo("converts empty string to null");
  });

  describe("when prompt handle is null", () => {
    it.todo("keeps handle as null");
  });

  describe("when prompt handle is valid", () => {
    it.todo("keeps valid handle unchanged");
  });
});
