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

        callbacks.onLocalConfigChange?.(config);

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

        callbacks.onLocalConfigChange?.(undefined);

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

        callbacks.onLocalConfigChange?.({ name: "Test" });

        expect(updateTarget).toHaveBeenCalledWith("eval-target-42", {
          localEvaluatorConfig: { name: "Test" },
        });
      });
    });

    describe("when targetId is omitted", () => {
      it("does not include onLocalConfigChange", () => {
        const callbacks = createEvaluatorEditorCallbacks({
          onMappingChange: vi.fn(),
        });

        expect(callbacks.onLocalConfigChange).toBeUndefined();
      });
    });
  });

  describe("onMappingChange()", () => {
    // @regression: onMappingChange was embedded inside mappingsConfig objects
    // passed to openDrawer, causing it to be lost when complexProps was cleared.
    // Now it flows through createEvaluatorEditorCallbacks → setFlowCallbacks.

    describe("when provided", () => {
      it("includes onMappingChange in the returned callbacks", () => {
        const onMappingChange = vi.fn();
        const callbacks = createEvaluatorEditorCallbacks({
          targetId: "target-1",
          updateTarget: vi.fn(),
          onMappingChange,
        });

        callbacks.onMappingChange?.("input", {
          type: "source",
          sourceId: "dataset-1",
          path: ["col-a"],
        });

        expect(onMappingChange).toHaveBeenCalledWith("input", {
          type: "source",
          sourceId: "dataset-1",
          path: ["col-a"],
        });
      });
    });

    describe("when omitted", () => {
      it("does not include onMappingChange in the returned callbacks", () => {
        const callbacks = createEvaluatorEditorCallbacks({
          targetId: "target-1",
          updateTarget: vi.fn(),
        });

        expect(callbacks.onMappingChange).toBeUndefined();
      });
    });
  });
});
