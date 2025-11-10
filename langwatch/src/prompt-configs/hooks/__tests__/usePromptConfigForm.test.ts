/* eslint-disable @typescript-eslint/no-empty-function */
import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { usePromptConfigForm } from "../usePromptConfigForm";

describe("usePromptConfigForm", () => {
  describe("when initialConfigValues are valid", () => {
    it("parses and uses the provided values", () => {
      const { result } = renderHook(() =>
        usePromptConfigForm({
          initialConfigValues: {
            handle: "test-handle",
            scope: "PROJECT" as const,
            version: {
              configData: {
                prompt: "Test prompt",
                inputs: [{ identifier: "input", type: "str" }],
                outputs: [{ identifier: "output", type: "str" }],
              },
            },
          },
        }),
      );

      expect(result.current.methods.getValues("handle")).toBe("test-handle");
      expect(result.current.methods.getValues("version.configData.prompt")).toBe(
        "Test prompt",
      );
    });
  });

  describe("when initialConfigValues are corrupted", () => {
    it("salvages valid parts and uses defaults for invalid parts", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const { result } = renderHook(() =>
        usePromptConfigForm({
          initialConfigValues: {
            handle: "valid-handle", // This should be salvaged
            // Missing required field: scope
            version: {
              configData: {
                prompt: "Valid prompt text", // This should be salvaged
                inputs: [{ identifier: "", type: "str" }], // Empty identifier - invalid
                outputs: [{ identifier: "output", type: "str" }], // Valid - should be salvaged
              },
            },
          } as any,
        }),
      );

      // Should not crash
      expect(result.current.methods.getValues("scope")).toBeDefined();
      
      // Should salvage valid parts
      expect(result.current.methods.getValues("handle")).toBe("valid-handle");
      expect(result.current.methods.getValues("version.configData.prompt")).toBe("Valid prompt text");
      expect(result.current.methods.getValues("version.configData.outputs")).toHaveLength(1);
      expect(result.current.methods.getValues("version.configData.outputs.0.identifier")).toBe("output");
      
      // Should use defaults for invalid/missing parts
      expect(result.current.methods.getValues("version.configData.llm")).toBeDefined();
      expect(result.current.methods.getValues("version.configData.inputs")).toBeDefined();
      
      consoleWarnSpy.mockRestore();
    });
  });
});

