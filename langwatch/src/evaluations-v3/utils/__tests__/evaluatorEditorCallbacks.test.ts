/**
 * Unit tests for evaluatorEditorCallbacks factory.
 *
 * Tests that:
 * - onLocalConfigChange(config) calls updateTarget with localEvaluatorConfig
 * - onLocalConfigChange(undefined) clears localEvaluatorConfig
 */

import { describe, expect, it, vi } from "vitest";
import { createEvaluatorEditorCallbacks } from "../evaluatorEditorCallbacks";
import type { LocalEvaluatorConfig } from "../../types";

describe("createEvaluatorEditorCallbacks()", () => {
  describe("onLocalConfigChange()", () => {
    describe("when called with a config object", () => {
      it("calls updateTarget with localEvaluatorConfig set", () => {
        const updateTarget = vi.fn();
        const callbacks = createEvaluatorEditorCallbacks({
          targetId: "target-1",
          updateTarget,
        });

        const config: LocalEvaluatorConfig = {
          name: "Modified Evaluator",
          settings: { threshold: 0.8 },
        };

        callbacks.onLocalConfigChange(config);

        expect(updateTarget).toHaveBeenCalledWith("target-1", {
          localEvaluatorConfig: config,
        });
      });
    });

    describe("when called with undefined", () => {
      it("calls updateTarget with localEvaluatorConfig undefined to clear it", () => {
        const updateTarget = vi.fn();
        const callbacks = createEvaluatorEditorCallbacks({
          targetId: "target-1",
          updateTarget,
        });

        callbacks.onLocalConfigChange(undefined);

        expect(updateTarget).toHaveBeenCalledWith("target-1", {
          localEvaluatorConfig: undefined,
        });
      });
    });

    describe("when used with different target IDs", () => {
      it("passes the correct targetId to updateTarget", () => {
        const updateTarget = vi.fn();
        const callbacks = createEvaluatorEditorCallbacks({
          targetId: "eval-target-42",
          updateTarget,
        });

        callbacks.onLocalConfigChange({ name: "Test" });

        expect(updateTarget).toHaveBeenCalledWith("eval-target-42", {
          localEvaluatorConfig: { name: "Test" },
        });
      });
    });
  });
});
