/**
 * Tests for per-dataset mapping behavior in Evaluations V3.
 *
 * @vitest-environment jsdom
 *
 * These tests verify that:
 * 1. Mappings are stored per-dataset
 * 2. Store actions work correctly with per-dataset structure
 * 3. The useEvaluationMappings hook returns correct data reactively
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEvaluationMappings } from "../hooks/useEvaluationMappings";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { DatasetReference, TargetConfig } from "../types";
import { createInitialInlineDataset, DEFAULT_TEST_DATA_ID } from "../types";

// ============================================================================
// Test Data
// ============================================================================

const createTestDataset = (
  id: string,
  name: string,
  columns: Array<{ name: string; type: "string" | "number" | "boolean" }>,
): DatasetReference => ({
  id,
  name,
  type: "inline",
  inline: createInitialInlineDataset(),
  columns: columns.map((col) => ({
    id: col.name,
    name: col.name,
    type: col.type,
  })),
});

const createTestTarget = (id: string): TargetConfig => ({
  id,
  type: "prompt",
  name: `Target ${id}`,
  inputs: [
    { identifier: "question", type: "str" },
    { identifier: "context", type: "str" },
  ],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
});

// ============================================================================
// Tests
// ============================================================================

describe("Per-Dataset Mappings", () => {
  beforeEach(() => {
    // Reset store before each test
    act(() => {
      useEvaluationsV3Store.getState().reset();
    });
  });

  afterEach(() => {
    act(() => {
      useEvaluationsV3Store.getState().reset();
    });
  });

  describe("setTargetMapping stores mappings per dataset", () => {
    it("stores mapping under the specified datasetId", () => {
      const store = useEvaluationsV3Store.getState();

      store.addTarget(createTestTarget("target-1"));
      store.setTargetMapping("target-1", DEFAULT_TEST_DATA_ID, "question", {
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });

      const state = useEvaluationsV3Store.getState();
      const target = state.targets.find((r) => r.id === "target-1");

      expect(target?.mappings[DEFAULT_TEST_DATA_ID]).toBeDefined();
      expect(target?.mappings[DEFAULT_TEST_DATA_ID]?.question).toEqual({
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });
    });

    it("stores different mappings for different datasets", () => {
      const store = useEvaluationsV3Store.getState();

      store.addDataset(
        createTestDataset("dataset-2", "Dataset 2", [
          { name: "foo", type: "string" },
          { name: "bar", type: "string" },
        ]),
      );
      store.addTarget(createTestTarget("target-1"));

      // Set mapping for default dataset
      store.setTargetMapping("target-1", DEFAULT_TEST_DATA_ID, "question", {
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });

      // Set different mapping for dataset-2
      store.setTargetMapping("target-1", "dataset-2", "question", {
        type: "source",
        source: "dataset",
        sourceId: "dataset-2",
        sourceField: "foo",
      });

      const state = useEvaluationsV3Store.getState();
      const target = state.targets.find((r) => r.id === "target-1");

      // Each dataset should have its own mapping
      const mapping1 = target?.mappings[DEFAULT_TEST_DATA_ID]?.question;
      const mapping2 = target?.mappings["dataset-2"]?.question;
      expect(mapping1?.type).toBe("source");
      expect(mapping1?.type === "source" && mapping1.sourceField).toBe("input");
      expect(mapping2?.type).toBe("source");
      expect(mapping2?.type === "source" && mapping2.sourceField).toBe("foo");
    });
  });

  describe("removeTargetMapping removes mapping for specific dataset", () => {
    it("removes only the specified mapping", () => {
      const store = useEvaluationsV3Store.getState();

      store.addTarget(createTestTarget("target-1"));
      store.setTargetMapping("target-1", DEFAULT_TEST_DATA_ID, "question", {
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });
      store.setTargetMapping("target-1", DEFAULT_TEST_DATA_ID, "context", {
        type: "value",
        value: "some context",
      });

      store.removeTargetMapping("target-1", DEFAULT_TEST_DATA_ID, "question");

      const state = useEvaluationsV3Store.getState();
      const target = state.targets.find((r) => r.id === "target-1");

      expect(target?.mappings[DEFAULT_TEST_DATA_ID]?.question).toBeUndefined();
      expect(target?.mappings[DEFAULT_TEST_DATA_ID]?.context).toBeDefined();
    });
  });

  describe("useEvaluationMappings hook", () => {
    it("returns available sources from active dataset only", () => {
      const store = useEvaluationsV3Store.getState();

      store.addDataset(
        createTestDataset("dataset-2", "Dataset 2", [
          { name: "foo", type: "string" },
        ]),
      );
      store.addTarget(createTestTarget("target-1"));

      const { result } = renderHook(() => useEvaluationMappings("target-1"));

      // Should only have the active dataset (default)
      expect(result.current.availableSources).toHaveLength(1);
      expect(result.current.availableSources[0]?.id).toBe(DEFAULT_TEST_DATA_ID);
    });

    it("returns mappings for active dataset", () => {
      const store = useEvaluationsV3Store.getState();

      store.addTarget(createTestTarget("target-1"));
      store.setTargetMapping("target-1", DEFAULT_TEST_DATA_ID, "question", {
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });

      const { result } = renderHook(() => useEvaluationMappings("target-1"));

      const mapping = result.current.inputMappings.question;
      expect(mapping).toBeDefined();
      // UI mapping uses sourceId
      expect(mapping?.type).toBe("source");
      if (mapping?.type === "source") {
        expect(mapping.sourceId).toBe(DEFAULT_TEST_DATA_ID);
      }
    });

    it("updates when active dataset changes", () => {
      const store = useEvaluationsV3Store.getState();

      // Setup: two datasets with different mappings
      store.addDataset(
        createTestDataset("dataset-2", "Dataset 2", [
          { name: "foo", type: "string" },
        ]),
      );
      store.addTarget(createTestTarget("target-1"));

      store.setTargetMapping("target-1", DEFAULT_TEST_DATA_ID, "question", {
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });
      store.setTargetMapping("target-1", "dataset-2", "question", {
        type: "source",
        source: "dataset",
        sourceId: "dataset-2",
        sourceField: "foo",
      });

      const { result, rerender } = renderHook(() =>
        useEvaluationMappings("target-1"),
      );

      // Initially shows default dataset mappings
      const initialMapping = result.current.inputMappings.question;
      expect(initialMapping?.type).toBe("source");
      if (initialMapping?.type === "source") {
        expect(initialMapping.sourceId).toBe(DEFAULT_TEST_DATA_ID);
      }
      expect(result.current.availableSources[0]?.id).toBe(DEFAULT_TEST_DATA_ID);

      // Switch to dataset-2
      act(() => {
        useEvaluationsV3Store.getState().setActiveDataset("dataset-2");
      });
      rerender();

      // Should now show dataset-2 mappings
      const updatedMapping = result.current.inputMappings.question;
      expect(updatedMapping?.type).toBe("source");
      if (updatedMapping?.type === "source") {
        expect(updatedMapping.sourceId).toBe("dataset-2");
      }
      expect(result.current.availableSources[0]?.id).toBe("dataset-2");
    });

    it("returns empty mappings for new dataset without mappings", () => {
      const store = useEvaluationsV3Store.getState();

      store.addDataset(
        createTestDataset("dataset-2", "Dataset 2", [
          { name: "foo", type: "string" },
        ]),
      );
      store.addTarget(createTestTarget("target-1"));

      // Only add mapping for default dataset
      store.setTargetMapping("target-1", DEFAULT_TEST_DATA_ID, "question", {
        type: "source",
        source: "dataset",
        sourceId: DEFAULT_TEST_DATA_ID,
        sourceField: "input",
      });

      const { result, rerender } = renderHook(() =>
        useEvaluationMappings("target-1"),
      );

      // Default dataset has mapping
      expect(result.current.inputMappings.question).toBeDefined();

      // Switch to dataset-2 (no mappings defined)
      act(() => {
        useEvaluationsV3Store.getState().setActiveDataset("dataset-2");
      });
      rerender();

      // Should have no mappings
      expect(result.current.inputMappings.question).toBeUndefined();
      expect(Object.keys(result.current.inputMappings)).toHaveLength(0);
    });

    it("returns isValid false when target not found", () => {
      const { result } = renderHook(() =>
        useEvaluationMappings("non-existent"),
      );

      expect(result.current.isValid).toBe(false);
      expect(result.current.availableSources).toHaveLength(1); // Still has active dataset
      expect(result.current.inputMappings).toEqual({});
    });

    it("returns empty for undefined targetId", () => {
      const { result } = renderHook(() => useEvaluationMappings(undefined));

      expect(result.current.isValid).toBe(false);
    });
  });

  describe("evaluator mappings per-dataset per-target", () => {
    it("stores evaluator mapping with dataset and target dimensions", () => {
      const store = useEvaluationsV3Store.getState();

      store.addTarget(createTestTarget("target-1"));
      store.addEvaluator({
        id: "eval-1",
        evaluatorType: "langevals/exact_match",
        name: "Exact Match",
        settings: {},
        inputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });

      store.setEvaluatorMapping(
        "eval-1",
        DEFAULT_TEST_DATA_ID,
        "target-1",
        "output",
        {
          type: "source",
          source: "target",
          sourceId: "target-1",
          sourceField: "output",
        },
      );

      const state = useEvaluationsV3Store.getState();
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");

      expect(evaluator?.mappings[DEFAULT_TEST_DATA_ID]).toBeDefined();
      expect(
        evaluator?.mappings[DEFAULT_TEST_DATA_ID]?.["target-1"],
      ).toBeDefined();
      expect(
        evaluator?.mappings[DEFAULT_TEST_DATA_ID]?.["target-1"]?.output,
      ).toEqual({
        type: "source",
        source: "target",
        sourceId: "target-1",
        sourceField: "output",
      });
    });

    it("can have different evaluator mappings for different datasets", () => {
      const store = useEvaluationsV3Store.getState();

      store.addDataset(
        createTestDataset("dataset-2", "Dataset 2", [
          { name: "expected", type: "string" },
        ]),
      );
      store.addTarget(createTestTarget("target-1"));
      store.addEvaluator({
        id: "eval-1",
        evaluatorType: "langevals/exact_match",
        name: "Exact Match",
        settings: {},
        inputs: [
          { identifier: "output", type: "str" },
          { identifier: "expected", type: "str" },
        ],
        mappings: {},
      });

      // Different expected_output mappings for different datasets
      store.setEvaluatorMapping(
        "eval-1",
        DEFAULT_TEST_DATA_ID,
        "target-1",
        "expected",
        {
          type: "source",
          source: "dataset",
          sourceId: DEFAULT_TEST_DATA_ID,
          sourceField: "expected_output",
        },
      );
      store.setEvaluatorMapping("eval-1", "dataset-2", "target-1", "expected", {
        type: "source",
        source: "dataset",
        sourceId: "dataset-2",
        sourceField: "expected",
      });

      const state = useEvaluationsV3Store.getState();
      const evaluator = state.evaluators.find((e) => e.id === "eval-1");

      const mapping1 =
        evaluator?.mappings[DEFAULT_TEST_DATA_ID]?.["target-1"]?.expected;
      const mapping2 = evaluator?.mappings["dataset-2"]?.["target-1"]?.expected;

      expect(mapping1?.type).toBe("source");
      expect(mapping1?.type === "source" && mapping1.sourceField).toBe(
        "expected_output",
      );
      expect(mapping2?.type).toBe("source");
      expect(mapping2?.type === "source" && mapping2.sourceField).toBe(
        "expected",
      );
    });
  });

  describe("Mapping preservation on target updates", () => {
    it("preserves existing mappings when target is updated", () => {
      const store = useEvaluationsV3Store.getState();

      store.addDataset(
        createTestDataset("ds-1", "Dataset 1", [
          { name: "input", type: "string" },
          { name: "context", type: "string" },
        ]),
      );
      store.setActiveDataset("ds-1");

      // Add target with one input
      store.addTarget({
        id: "target-1",
        type: "prompt",
        name: "Test Target",
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });

      // Manually set a custom mapping for "question"
      store.setTargetMapping("target-1", "ds-1", "question", {
        type: "value",
        value: "hardcoded value",
      });

      // Update target name (doesn't touch inputs)
      store.updateTarget("target-1", {
        name: "Updated Target",
      });

      const state = useEvaluationsV3Store.getState();
      const target = state.targets.find((r) => r.id === "target-1");

      // Existing mapping should be preserved
      expect(target?.mappings["ds-1"]?.question?.type).toBe("value");
      expect(target?.name).toBe("Updated Target");
    });
  });
});
