/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useModelLimits", () => ({
  useModelLimits: () => ({ limits: undefined, isLoading: false, error: null }),
}));

describe("usePromptConfigForm", () => {
  describe("when stale props arrive after user edits a dirty field", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Regression test for issue #2803.
     *
     * Root cause: the reverse sync (form → onChange) sets disableNodeSyncRef=true,
     * then releases it after only 1ms. The debounced store write triggers a re-render
     * that fires the forward sync (parsedInitialValues → form) — but by then the guard
     * is already released, so the forward sync overwrites the user's model selection.
     */
    it("does not overwrite user model selection when parsedInitialValues change after the guard is released", async () => {
      const { usePromptConfigForm } = await import("../usePromptConfigForm");

      const initialConfigValues = {
        version: {
          configData: {
            llm: { model: "openai/gpt-4o" },
            messages: [
              {
                role: "system" as const,
                content: "You are a helpful assistant.",
              },
              { role: "user" as const, content: "{{input}}" },
            ],
            inputs: [{ identifier: "input", type: "str" as const }],
            outputs: [{ identifier: "output", type: "str" as const }],
          },
        },
      };

      const onChangeMock = vi.fn();

      const { result, rerender } = renderHook(
        ({ configValues }: { configValues: typeof initialConfigValues }) =>
          usePromptConfigForm({
            initialConfigValues: configValues,
            onChange: onChangeMock,
          }),
        { initialProps: { configValues: initialConfigValues } },
      );

      // User changes the model selection
      act(() => {
        result.current.methods.setValue(
          "version.configData.llm.model",
          "openai/gpt-5-mini",
          { shouldDirty: true },
        );
      });

      // Verify the form reflects the user's selection
      expect(
        result.current.methods.getValues("version.configData.llm.model"),
      ).toBe("openai/gpt-5-mini");

      // The reverse sync fires and sets disableNodeSyncRef=true, then schedules a 1ms
      // release. Advance past the 1ms guard release — now disableNodeSyncRef=false again.
      act(() => {
        vi.advanceTimersByTime(1);
      });

      // Simulate the debounced store write completing: the parent re-renders with
      // "updated" initialConfigValues (still the old model — store hasn't propagated yet).
      // This is the scenario that triggers the race condition: parsedInitialValues changes
      // reference (new object) but still contains the OLD model, and since disableNodeSyncRef
      // is now false, the forward sync runs and would overwrite the form.
      const staleConfigValues = {
        version: {
          configData: {
            llm: { model: "openai/gpt-4o" }, // stale — store write hasn't propagated
            messages: [
              {
                role: "system" as const,
                content: "You are a helpful assistant.",
              },
              { role: "user" as const, content: "{{input}}" },
            ],
            inputs: [{ identifier: "input", type: "str" as const }],
            outputs: [{ identifier: "output", type: "str" as const }],
          },
        },
      };

      act(() => {
        rerender({ configValues: staleConfigValues });
      });

      // The form model must still be the user's selection, not the stale node value
      expect(
        result.current.methods.getValues("version.configData.llm.model"),
      ).toBe("openai/gpt-5-mini");
    });
  });
});
