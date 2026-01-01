/**
 * Tests for mapping validation UI feedback.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, screen, cleanup } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { RunnerHeader } from "../components/RunnerSection/RunnerHeader";
import type { RunnerConfig, DatasetReference } from "../types";
import { DEFAULT_TEST_DATA_ID } from "../types";
import {
  getRunnerMissingMappings,
  runnerHasMissingMappings,
  validateWorkbench,
  extractFieldsFromContent,
  getUsedFields,
} from "../utils/mappingValidation";

const createTestDataset = (
  id: string = DEFAULT_TEST_DATA_ID,
  name: string = "Test Data",
  columns: Array<{ name: string; type: "string" | "number" | "boolean" }> = [
    { name: "input", type: "string" },
    { name: "expected_output", type: "string" },
  ]
): DatasetReference => ({
  id,
  name,
  type: "inline",
  columns: columns.map((c) => ({ id: c.name, ...c })),
});

const createTestRunner = (
  id: string,
  inputs: Array<{ identifier: string; type: string }> = [{ identifier: "question", type: "str" }],
  mappings: RunnerConfig["mappings"] = {}
): RunnerConfig => ({
  id,
  type: "prompt",
  name: `Runner ${id}`,
  inputs: inputs.map((i) => ({ ...i, type: i.type as "str" })),
  outputs: [{ identifier: "output", type: "str" }],
  mappings,
  evaluatorIds: [],
  localPromptConfig: {
    llm: { model: "gpt-4" },
    messages: [{ role: "user", content: `Hello {{${inputs[0]?.identifier || "input"}}}` }],
    inputs: inputs.map((i) => ({ identifier: i.identifier, type: i.type as "str" })),
    outputs: [{ identifier: "output", type: "str" }],
  },
});

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  // Reset store before each test
  act(() => {
    useEvaluationsV3Store.getState().reset();
  });
  // Initialize store with default dataset
  act(() => {
    useEvaluationsV3Store.getState().addDataset(createTestDataset());
  });
});

afterEach(() => {
  act(() => {
    useEvaluationsV3Store.getState().reset();
  });
  cleanup();
});

// ============================================================================
// Tests: mappingValidation utility
// ============================================================================

describe("mappingValidation utility", () => {
  describe("extractFieldsFromContent", () => {
    it("extracts fields from template content", () => {
      const content = "Hello {{name}}, your order {{orderId}} is ready.";
      const fields = extractFieldsFromContent(content);
      expect(fields.has("name")).toBe(true);
      expect(fields.has("orderId")).toBe(true);
      expect(fields.size).toBe(2);
    });

    it("returns empty set for content without fields", () => {
      const content = "Hello world!";
      const fields = extractFieldsFromContent(content);
      expect(fields.size).toBe(0);
    });

    it("handles duplicate fields", () => {
      const content = "{{name}} said hello to {{name}}";
      const fields = extractFieldsFromContent(content);
      expect(fields.size).toBe(1);
      expect(fields.has("name")).toBe(true);
    });
  });

  describe("getUsedFields", () => {
    it("extracts used fields from prompt messages", () => {
      const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }]);
      const fields = getUsedFields(runner);
      expect(fields.has("question")).toBe(true);
    });

    it("returns all inputs for code runners", () => {
      const runner: RunnerConfig = {
        ...createTestRunner("r1", [
          { identifier: "input1", type: "str" },
          { identifier: "input2", type: "str" },
        ]),
        type: "agent",
        localPromptConfig: undefined,
      };
      const fields = getUsedFields(runner);
      expect(fields.has("input1")).toBe(true);
      expect(fields.has("input2")).toBe(true);
    });
  });

  describe("getRunnerMissingMappings", () => {
    it("identifies missing mappings for used fields", () => {
      const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {});
      const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);

      expect(result.isValid).toBe(false);
      expect(result.missingMappings.length).toBe(1);
      expect(result.missingMappings[0]?.fieldId).toBe("question");
    });

    it("returns valid when all used fields are mapped", () => {
      const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {
        [DEFAULT_TEST_DATA_ID]: {
          question: {
            type: "source",
            source: "dataset",
            sourceId: DEFAULT_TEST_DATA_ID,
            sourceField: "input",
          },
        },
      });
      const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);
      expect(result.isValid).toBe(true);
      expect(result.missingMappings.length).toBe(0);
    });

    it("considers value mappings as valid", () => {
      const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {
        [DEFAULT_TEST_DATA_ID]: {
          question: {
            type: "value",
            value: "Hello world",
          },
        },
      });
      const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);
      expect(result.isValid).toBe(true);
    });
  });

  describe("runnerHasMissingMappings", () => {
    it("returns true when mappings are missing", () => {
      const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {});
      expect(runnerHasMissingMappings(runner, DEFAULT_TEST_DATA_ID)).toBe(true);
    });

    it("returns false when all mappings are set", () => {
      const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {
        [DEFAULT_TEST_DATA_ID]: {
          question: {
            type: "source",
            source: "dataset",
            sourceId: DEFAULT_TEST_DATA_ID,
            sourceField: "input",
          },
        },
      });
      expect(runnerHasMissingMappings(runner, DEFAULT_TEST_DATA_ID)).toBe(false);
    });
  });

  describe("validateWorkbench", () => {
    it("returns valid when all runners have mappings", () => {
      const runners = [
        createTestRunner("r1", [{ identifier: "question", type: "str" }], {
          [DEFAULT_TEST_DATA_ID]: {
            question: {
              type: "source",
              source: "dataset",
              sourceId: DEFAULT_TEST_DATA_ID,
              sourceField: "input",
            },
          },
        }),
      ];
      const result = validateWorkbench(runners, [], DEFAULT_TEST_DATA_ID);
      expect(result.isValid).toBe(true);
    });

    it("returns first invalid runner", () => {
      const runners = [
        createTestRunner("r1", [{ identifier: "question", type: "str" }], {
          [DEFAULT_TEST_DATA_ID]: {
            question: {
              type: "source",
              source: "dataset",
              sourceId: DEFAULT_TEST_DATA_ID,
              sourceField: "input",
            },
          },
        }),
        createTestRunner("r2", [{ identifier: "context", type: "str" }], {}),
      ];
      const result = validateWorkbench(runners, [], DEFAULT_TEST_DATA_ID);

      expect(result.isValid).toBe(false);
      expect(result.firstInvalidRunner?.runner.id).toBe("r2");
    });
  });
});

// ============================================================================
// Tests: RunnerHeader alert icon
// ============================================================================

describe("RunnerHeader alert icon", () => {
  it("shows alert icon when runner has missing mappings", () => {
    const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {});

    renderWithProviders(
      <RunnerHeader
        runner={runner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(screen.getByTestId("missing-mapping-alert")).toBeInTheDocument();
  });

  it("does not show alert icon when all mappings are set", () => {
    const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {
      [DEFAULT_TEST_DATA_ID]: {
        question: {
          type: "source",
          source: "dataset",
          sourceId: DEFAULT_TEST_DATA_ID,
          sourceField: "input",
        },
      },
    });

    renderWithProviders(
      <RunnerHeader
        runner={runner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(screen.queryByTestId("missing-mapping-alert")).not.toBeInTheDocument();
  });

  it("shows unpublished indicator when no missing mappings but has local changes", () => {
    const runner: RunnerConfig = {
      ...createTestRunner("r1", [{ identifier: "question", type: "str" }], {
        [DEFAULT_TEST_DATA_ID]: {
          question: {
            type: "source",
            source: "dataset",
            sourceId: DEFAULT_TEST_DATA_ID,
            sourceField: "input",
          },
        },
      }),
      localPromptConfig: {
        llm: { model: "gpt-4" },
        messages: [{ role: "user", content: "Hello {{question}}" }],
        inputs: [{ identifier: "question", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
      },
    };

    renderWithProviders(
      <RunnerHeader
        runner={runner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    expect(screen.queryByTestId("missing-mapping-alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("unpublished-indicator")).toBeInTheDocument();
  });
});

// ============================================================================
// Tests: Validation edge cases (issues 3 & 4)
// ============================================================================

describe("Validation edge cases", () => {
  it("returns no missing mappings for prompt runner without localPromptConfig", () => {
    // Issue 4 fix: When prompt content isn't loaded yet, we can't know which fields are used
    // So we return valid (no missing mappings) until the content is available
    const runner: RunnerConfig = {
      ...createTestRunner("r1", [{ identifier: "input", type: "str" }]),
      localPromptConfig: undefined, // Explicitly no localPromptConfig - prompt not loaded yet
    };

    const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);

    // Should be valid because we don't know what fields are used yet
    expect(result.isValid).toBe(true);
    expect(result.missingMappings.length).toBe(0);
  });

  it("uses localPromptConfig.inputs when it differs from runner.inputs (form-added variables)", () => {
    // CRITICAL: This tests the real-world scenario where:
    // 1. Runner was created with initial inputs (e.g., just "input")
    // 2. User opens drawer and adds {{foo}} via the form
    // 3. Form adds "foo" to localPromptConfig.inputs, but runner.inputs stays unchanged
    // The validation must use localPromptConfig.inputs, not runner.inputs!
    const runner: RunnerConfig = {
      id: "r1",
      type: "prompt",
      name: "Test Runner",
      // Original runner.inputs - only has "input"
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
      evaluatorIds: [],
      // localPromptConfig has BOTH "input" and "foo" (added via form)
      localPromptConfig: {
        llm: { model: "gpt-4" },
        messages: [{ role: "user", content: "Hello {{input}} and {{foo}}" }],
        inputs: [
          { identifier: "input", type: "str" },
          { identifier: "foo", type: "str" }, // Added via form!
        ],
        outputs: [{ identifier: "output", type: "str" }],
      },
    };

    const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);

    // Both "input" and "foo" should be detected as missing
    // If this only detects "input", the bug is that we're using runner.inputs
    // instead of localPromptConfig.inputs
    expect(result.isValid).toBe(false);
    expect(result.missingMappings.length).toBe(2);
    expect(result.missingMappings.map((m) => m.fieldId)).toContain("input");
    expect(result.missingMappings.map((m) => m.fieldId)).toContain("foo");
  });

  it("only detects missing mapping for fields that are BOTH used AND in inputs list", () => {
    // Fields used in prompt but NOT in inputs list ("Undefined variables") are NOT required.
    // Only fields that are both used AND defined in inputs require mappings.
    const runner: RunnerConfig = {
      ...createTestRunner("r1", [{ identifier: "question", type: "str" }]),
      localPromptConfig: {
        llm: { model: "gpt-4" },
        messages: [{ role: "user", content: "Hello {{question}} and {{foo}}" }], // foo used but not in inputs
        inputs: [{ identifier: "question", type: "str" }], // foo not listed
        outputs: [{ identifier: "output", type: "str" }],
      },
    };

    const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);

    // Only "question" should be detected as missing (it's both used AND in inputs)
    // "foo" is used but NOT in inputs - this is fine ("Undefined variables" warning, not mapping error)
    expect(result.isValid).toBe(false);
    expect(result.missingMappings.length).toBe(1);
    expect(result.missingMappings.map((m) => m.fieldId)).toContain("question");
    expect(result.missingMappings.map((m) => m.fieldId)).not.toContain("foo");
  });

  it("does not report missing for field deleted from inputs but mapped in other dataset", () => {
    // Issue 4: Field "input" was deleted, but mapping still exists in another dataset
    // The field is NOT used in the prompt anymore, so it should NOT be reported
    const runner: RunnerConfig = {
      ...createTestRunner("r1", []), // Empty inputs - field was deleted
      localPromptConfig: {
        llm: { model: "gpt-4" },
        messages: [{ role: "user", content: "Hello world" }], // No fields used
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      },
      mappings: {
        // Zombie mapping - field "input" was deleted but mapping still exists
        "other-dataset": {
          input: {
            type: "source",
            source: "dataset",
            sourceId: "other-dataset",
            sourceField: "some_column",
          },
        },
      },
    };

    const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);

    // No missing mappings because no fields are used in the prompt
    expect(result.isValid).toBe(true);
    expect(result.missingMappings.length).toBe(0);
  });

  it("correctly validates when field is removed from prompt but still in inputs", () => {
    // Field "context" is in inputs but not used in prompt
    const runner: RunnerConfig = {
      ...createTestRunner("r1", [
        { identifier: "question", type: "str" },
        { identifier: "context", type: "str" }, // In inputs but not used
      ]),
      localPromptConfig: {
        llm: { model: "gpt-4" },
        messages: [{ role: "user", content: "Hello {{question}}" }], // Only question used
        inputs: [
          { identifier: "question", type: "str" },
          { identifier: "context", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
      },
    };

    // Only map "question", leave "context" unmapped
    runner.mappings = {
      [DEFAULT_TEST_DATA_ID]: {
        question: {
          type: "source",
          source: "dataset",
          sourceId: DEFAULT_TEST_DATA_ID,
          sourceField: "input",
        },
      },
    };

    const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);

    // Should be valid because "context" is not used in the prompt
    expect(result.isValid).toBe(true);
    expect(result.missingMappings.length).toBe(0);
  });
});

// ============================================================================
// Tests: Runner play button validation
// ============================================================================

describe("Runner play button validation", () => {
  it("calls onEdit instead of onRun when mappings are missing", async () => {
    const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {});
    const onEdit = vi.fn();
    const onRun = vi.fn();

    renderWithProviders(
      <RunnerHeader
        runner={runner}
        onEdit={onEdit}
        onRemove={vi.fn()}
        onRun={onRun}
      />
    );

    const playButton = screen.getByTestId("runner-play-button");
    playButton.click();

    // Should call onEdit (to open drawer) instead of onRun
    expect(onEdit).toHaveBeenCalledWith(runner);
    expect(onRun).not.toHaveBeenCalled();
  });

  it("calls onRun when all mappings are set", async () => {
    const runner = createTestRunner("r1", [{ identifier: "question", type: "str" }], {
      [DEFAULT_TEST_DATA_ID]: {
        question: {
          type: "source",
          source: "dataset",
          sourceId: DEFAULT_TEST_DATA_ID,
          sourceField: "input",
        },
      },
    });
    const onEdit = vi.fn();
    const onRun = vi.fn();

    renderWithProviders(
      <RunnerHeader
        runner={runner}
        onEdit={onEdit}
        onRemove={vi.fn()}
        onRun={onRun}
      />
    );

    const playButton = screen.getByTestId("runner-play-button");
    playButton.click();

    // Should call onRun since all mappings are set
    expect(onRun).toHaveBeenCalledWith(runner);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
