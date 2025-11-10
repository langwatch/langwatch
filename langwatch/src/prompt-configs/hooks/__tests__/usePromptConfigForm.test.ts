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
    it("falls back to schema defaults", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      const { result } = renderHook(() =>
        usePromptConfigForm({
          initialConfigValues: {
            // Missing required fields like scope
            version: {
              configData: {
                // Missing required fields
                inputs: [{ identifier: "", type: "str" }], // Empty identifier
              },
            },
          } as any,
        }),
      );

      // Should not crash and should have default values
      expect(result.current.methods.getValues("scope")).toBeDefined();
      expect(result.current.methods.getValues("version.configData.llm")).toBeDefined();
      
      consoleWarnSpy.mockRestore();
    });
  });
});

