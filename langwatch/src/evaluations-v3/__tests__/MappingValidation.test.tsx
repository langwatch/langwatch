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
import type { RunnerConfig, DatasetReference, EvaluatorConfig } from "../types";
import { DEFAULT_TEST_DATA_ID } from "../types";
import {
  getRunnerMissingMappings,
  runnerHasMissingMappings,
  getEvaluatorMissingMappings,
  evaluatorHasMissingMappings,
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
  it("falls back to runner.inputs for validation when no localPromptConfig", () => {
    // When prompt content isn't loaded yet (no localPromptConfig),
    // we use runner.inputs as the source of fields that need mapping.
    // This ensures the alert icon shows even before the drawer is opened.
    const runner: RunnerConfig = {
      ...createTestRunner("r1", [{ identifier: "input", type: "str" }]),
      localPromptConfig: undefined, // Explicitly no localPromptConfig - prompt not loaded yet
    };

    const result = getRunnerMissingMappings(runner, DEFAULT_TEST_DATA_ID);

    // Should be INVALID because "input" is in runner.inputs but has no mapping
    expect(result.isValid).toBe(false);
    expect(result.missingMappings.length).toBe(1);
    expect(result.missingMappings[0]?.fieldId).toBe("input");
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
// Tests: Runner alert icon for missing mappings (Integration)
// ============================================================================

describe("Runner header alert icon integration", () => {
  it("shows alert icon when store runner has localPromptConfig with unmapped variables", () => {
    // This reproduces the actual bug:
    // 1. Runner is in the store with localPromptConfig (prompt was loaded)
    // 2. localPromptConfig has variables that aren't mapped
    // 3. Alert icon should show

    // First, add the runner to the store
    const runnerId = "runner-integration-1";
    act(() => {
      useEvaluationsV3Store.getState().addRunner({
        id: runnerId,
        type: "prompt",
        name: "Test Runner",
        inputs: [{ identifier: "input", type: "str" }], // Initial placeholder
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          [DEFAULT_TEST_DATA_ID]: {
            // Only "input" is mapped
            input: {
              type: "source",
              source: "dataset",
              sourceId: DEFAULT_TEST_DATA_ID,
              sourceField: "input",
            },
          },
        },
      });
    });

    // Simulate what happens when the prompt editor loads: localPromptConfig gets set
    // with the actual prompt variables
    act(() => {
      useEvaluationsV3Store.getState().updateRunner(runnerId, {
        localPromptConfig: {
          llm: { model: "gpt-4" },
          messages: [
            { role: "user", content: "Hello {{user_input}} and {{input}}" },
          ],
          inputs: [
            { identifier: "user_input", type: "str" },
            { identifier: "input", type: "str" },
          ],
          outputs: [{ identifier: "output", type: "str" }],
        },
      });
    });

    // Get the runner FROM THE STORE (like the real component does)
    const storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;

    renderWithProviders(
      <RunnerHeader
        runner={storeRunner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    // Alert icon SHOULD be present because "user_input" has no mapping
    const alertIcon = screen.queryByTestId("missing-mapping-alert");
    expect(alertIcon).toBeInTheDocument();
  });

  it("hides alert icon when all variables from localPromptConfig are mapped", () => {
    const runnerId = "runner-integration-2";
    act(() => {
      useEvaluationsV3Store.getState().addRunner({
        id: runnerId,
        type: "prompt",
        name: "Test Runner",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {
          [DEFAULT_TEST_DATA_ID]: {
            // BOTH variables are mapped
            user_input: {
              type: "source",
              source: "dataset",
              sourceId: DEFAULT_TEST_DATA_ID,
              sourceField: "input",
            },
            input: {
              type: "source",
              source: "dataset",
              sourceId: DEFAULT_TEST_DATA_ID,
              sourceField: "input",
            },
          },
        },
      });
    });

    // Set localPromptConfig with the prompt content
    act(() => {
      useEvaluationsV3Store.getState().updateRunner(runnerId, {
        localPromptConfig: {
          llm: { model: "gpt-4" },
          messages: [
            { role: "user", content: "Hello {{user_input}} and {{input}}" },
          ],
          inputs: [
            { identifier: "user_input", type: "str" },
            { identifier: "input", type: "str" },
          ],
          outputs: [{ identifier: "output", type: "str" }],
        },
      });
    });

    const storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;

    renderWithProviders(
      <RunnerHeader
        runner={storeRunner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    // Alert icon should NOT be present - all variables are mapped
    const alertIcon = screen.queryByTestId("missing-mapping-alert");
    expect(alertIcon).not.toBeInTheDocument();
  });

  it("shows alert icon when runner has variable that cannot be auto-inferred", () => {
    // This tests the real scenario:
    // 1. Dataset has columns: foo, bar (nothing that matches "my_custom_var")
    // 2. Prompt has variable: my_custom_var
    // 3. "my_custom_var" CANNOT be auto-inferred (no matching column or semantic equiv)
    // 4. Alert icon should show!

    // First, create a dataset with completely different column names
    act(() => {
      useEvaluationsV3Store.getState().addDataset({
        id: "dataset-no-match",
        name: "Dataset with no matching columns",
        type: "inline",
        columns: [
          { id: "foo", name: "foo", type: "string" },
          { id: "bar", name: "bar", type: "string" },
        ],
      });
      useEvaluationsV3Store.getState().setActiveDataset("dataset-no-match");
    });

    const runnerId = "runner-integration-3";
    act(() => {
      // addRunner will try to auto-infer but find nothing
      useEvaluationsV3Store.getState().addRunner({
        id: runnerId,
        type: "prompt",
        name: "Test Runner",
        inputs: [
          { identifier: "my_custom_var", type: "str" }, // No matching column at all!
        ],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });
    });

    const storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;

    // Verify "my_custom_var" was NOT auto-inferred (no matching column)
    expect(storeRunner.mappings["dataset-no-match"]?.my_custom_var).toBeUndefined();

    // Test the validation function directly
    const hasMissing = runnerHasMissingMappings(storeRunner, "dataset-no-match");
    expect(hasMissing).toBe(true); // Should have missing mappings

    renderWithProviders(
      <RunnerHeader
        runner={storeRunner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    // Alert icon SHOULD be present because "my_custom_var" has no mapping
    const alertIcon = screen.queryByTestId("missing-mapping-alert");
    expect(alertIcon).toBeInTheDocument();
  });

  it("shows alert when prompt has variable that cannot be auto-mapped", () => {
    // This simulates the flow when a prompt is loaded:
    // 1. Runner is created with placeholder inputs
    // 2. Drawer opens and loads prompt content
    // 3. onLocalConfigChange is called with the real inputs
    // 4. Inference runs for new inputs
    // 5. Variables that CAN be mapped (e.g., user_input → input) are mapped
    // 6. Variables that CANNOT be mapped show alert icon

    const runnerId = "runner-drawer-flow";

    // Step 1: Runner created with placeholder
    act(() => {
      useEvaluationsV3Store.getState().addRunner({
        id: runnerId,
        type: "prompt",
        name: "my-first-prompt",
        promptId: "some-prompt-id",
        inputs: [{ identifier: "input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });
    });

    // Step 2-4: Simulate what happens when drawer sets localPromptConfig
    // The onLocalConfigChange callback runs inference for new inputs
    // "custom_context" has NO matching column in dataset, so it won't be mapped
    act(() => {
      useEvaluationsV3Store.getState().updateRunner(runnerId, {
        localPromptConfig: {
          llm: { model: "gpt-5" },
          messages: [
            { role: "system", content: "Context: {{custom_context}}\nQuestion: {{input}}" },
          ],
          inputs: [
            { identifier: "custom_context", type: "str" }, // NO matching column!
            { identifier: "input", type: "str" },          // Will be mapped
          ],
          outputs: [{ identifier: "output", type: "str" }],
        },
      });
    });

    // Get updated runner
    const storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;

    // "input" should be mapped (exact match)
    expect(storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.input).toBeDefined();

    // "custom_context" should NOT be mapped (no matching column)
    // So validation should detect it as missing
    const hasMissing = runnerHasMissingMappings(storeRunner, DEFAULT_TEST_DATA_ID);
    expect(hasMissing).toBe(true);

    renderWithProviders(
      <RunnerHeader
        runner={storeRunner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    const alertIcon = screen.queryByTestId("missing-mapping-alert");
    expect(alertIcon).toBeInTheDocument();
  });

  it("cleared mapping stays cleared after closing and reopening drawer", () => {
    // Test that user-cleared mappings persist across drawer opens.
    //
    // Flow:
    // 1. Add runner with inputs (auto-mapping happens in addRunner)
    // 2. User clears a mapping
    // 3. User closes and reopens drawer
    // 4. Mapping should STILL be cleared (no re-auto-mapping)
    //
    // FIX: Auto-mapping only happens when runner is ADDED to workbench.
    // The drawer does NOT re-run auto-mapping on open.

    const runnerId = "runner-cleared-mapping";

    // Step 1: Add runner with real inputs - auto-mapping happens here
    act(() => {
      useEvaluationsV3Store.getState().addRunner({
        id: runnerId,
        type: "prompt",
        name: "test-prompt",
        inputs: [{ identifier: "user_input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });
    });

    // Verify auto-mapping worked (user_input -> input via semantic equivalents)
    let storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;
    expect(storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input).toBeDefined();
    expect(storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input?.type).toBe("source");

    // Step 2: User clears the mapping (clicks X on the tag)
    act(() => {
      useEvaluationsV3Store.getState().removeRunnerMapping(runnerId, DEFAULT_TEST_DATA_ID, "user_input");
    });

    // Verify mapping is cleared
    storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;
    expect(storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input).toBeUndefined();

    // Step 3 & 4: User closes and reopens drawer
    // With the fix, reopening the drawer does NOT re-run auto-mapping.
    // There's no action to simulate here because the drawer no longer calls any
    // initialization function. The mapping should remain cleared.

    // Final check: mapping is STILL cleared
    storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;
    expect(storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input).toBeUndefined();
  });

  it("auto-maps user_input to input column via semantic equivalents", () => {
    // This verifies that semantic equivalents work correctly:
    // user_input: ["input", ...] means user_input field can map to input column
    //
    // The flow:
    // 1. Add runner with real inputs (addRunner auto-maps)
    // 2. user_input gets mapped to input column via semantic equivalents

    const runnerId = "runner-semantic";

    // Add runner with the real inputs - auto-mapping happens in addRunner
    act(() => {
      useEvaluationsV3Store.getState().addRunner({
        id: runnerId,
        type: "prompt",
        name: "test-prompt",
        inputs: [{ identifier: "user_input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });
    });

    const storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;

    // user_input SHOULD be auto-mapped to input column via SEMANTIC_EQUIVALENTS
    // user_input: ["input", ...] means user_input field maps to input column
    const userInputMapping = storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input;
    expect(userInputMapping).toBeDefined();
    expect(userInputMapping?.type).toBe("source");
    if (userInputMapping?.type === "source") {
      expect(userInputMapping.sourceField).toBe("input");
    }

    // No missing mappings - user_input was successfully mapped
    const hasMissing = runnerHasMissingMappings(storeRunner, DEFAULT_TEST_DATA_ID);
    expect(hasMissing).toBe(false);

    renderWithProviders(
      <RunnerHeader
        runner={storeRunner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    // No alert icon - all mappings are complete
    const alertIcon = screen.queryByTestId("missing-mapping-alert");
    expect(alertIcon).not.toBeInTheDocument();
  });

  it("does not crash when updateRunner is called with inputs on a runner that has inputs undefined", () => {
    // BUG REPRO: This reproduces the exact crash:
    // "can't access property 'map', existingRunner.inputs is undefined"
    //
    // This happens when:
    // 1. A runner exists in the store without inputs (or with inputs: undefined)
    // 2. updateRunner is called with new inputs
    // 3. The store tries to do: existingRunner.inputs.map(...)
    // 4. CRASH because inputs is undefined

    const runnerId = "runner-crash-test";

    // Step 1: Create a runner WITHOUT inputs (simulating a bug or edge case)
    act(() => {
      const store = useEvaluationsV3Store.getState();
      // Directly set state to simulate a runner without inputs
      // This is the buggy state that causes the crash
      store.addRunner({
        id: runnerId,
        type: "prompt",
        name: "test-prompt",
        inputs: undefined as any, // Simulating the bug - inputs is undefined
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });
    });

    // Step 2: Try to update the runner with inputs - this should NOT crash
    expect(() => {
      act(() => {
        useEvaluationsV3Store.getState().updateRunner(runnerId, {
          inputs: [{ identifier: "user_input", type: "str" }],
        });
      });
    }).not.toThrow();

    // Step 3: Verify the runner now has the correct inputs
    const storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId);
    expect(storeRunner?.inputs).toHaveLength(1);
    expect(storeRunner?.inputs?.[0]?.identifier).toBe("user_input");
  });

  it("handles the exact flow when handleSelectPrompt callback fires", () => {
    // This reproduces the EXACT flow that causes the crash:
    // 1. handleSelectPrompt creates runner with placeholder inputs
    // 2. Opens drawer
    // 3. Drawer's form subscription fires onLocalConfigChange
    // 4. onLocalConfigChange calls updateRunner with new inputs
    // 5. CRASH if existingRunner.inputs is undefined

    const runnerId = "runner-select-prompt-flow";

    // Step 1: Simulate handleSelectPrompt creating a runner
    // This is what handleSelectPrompt does:
    const runnerConfig: RunnerConfig = {
      id: runnerId,
      type: "prompt",
      name: "my-first-prompt",
      promptId: "some-prompt-id",
      inputs: [{ identifier: "input", type: "str" }], // Placeholder
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
    };

    act(() => {
      useEvaluationsV3Store.getState().addRunner(runnerConfig);
    });

    // Verify runner was created with inputs
    let storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId);
    expect(storeRunner?.inputs).toBeDefined();
    expect(storeRunner?.inputs).toHaveLength(1);

    // Step 2: Simulate what onLocalConfigChange does when drawer loads
    // This should NOT crash
    expect(() => {
      act(() => {
        useEvaluationsV3Store.getState().updateRunner(runnerId, {
          localPromptConfig: {
            llm: { model: "gpt-5" },
            messages: [{ role: "system", content: "You are helpful. {{foobar}}" }],
            inputs: [{ identifier: "foobar", type: "str" }],
            outputs: [{ identifier: "output", type: "str" }],
          },
          inputs: [{ identifier: "foobar", type: "str" }],
        });
      });
    }).not.toThrow();

    // Step 3: Verify state is correct
    storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId);
    expect(storeRunner?.inputs).toHaveLength(1);
    expect(storeRunner?.inputs?.[0]?.identifier).toBe("foobar");
  });

  it("shows alert icon when prompt has unmapped variable after drawer loads", () => {
    // Flow:
    // 1. User adds prompt "my-first-prompt" to workbench
    // 2. handleSelectPrompt creates runner with REAL inputs from prompt list data
    // 3. addRunner auto-maps based on real inputs
    // 4. user_input gets auto-mapped to input column (via semantic equiv)
    // 5. foobar has NO mapping (no matching column)
    // 6. Alert icon SHOULD show because foobar is unmapped

    const runnerId = "runner-alert-test";

    // handleSelectPrompt now gets real inputs from PromptListDrawer
    // and passes them directly to addRunner (no more placeholder inputs)
    act(() => {
      useEvaluationsV3Store.getState().addRunner({
        id: runnerId,
        type: "prompt",
        name: "my-first-prompt",
        promptId: "some-prompt-id",
        inputs: [
          { identifier: "foobar", type: "str" },
          { identifier: "user_input", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });
    });

    // Get runner - auto-mapping already happened in addRunner
    const storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;

    // Verify inputs are set
    expect(storeRunner.inputs).toHaveLength(2);
    expect(storeRunner.inputs.map(i => i.identifier)).toContain("foobar");
    expect(storeRunner.inputs.map(i => i.identifier)).toContain("user_input");

    // user_input should be mapped (via semantic equivalents user_input -> input)
    const userInputMapping = storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input;
    expect(userInputMapping).toBeDefined(); // Should be auto-mapped

    // foobar should NOT be mapped (no matching column)
    const foobarMapping = storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.foobar;
    expect(foobarMapping).toBeUndefined();

    // Validation should detect foobar is missing
    const hasMissing = runnerHasMissingMappings(storeRunner, DEFAULT_TEST_DATA_ID);
    expect(hasMissing).toBe(true); // foobar has no mapping!

    // Render RunnerHeader and check for alert icon
    renderWithProviders(
      <RunnerHeader
        runner={storeRunner}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />
    );

    // Alert icon SHOULD be present because foobar has no mapping
    const alertIcon = screen.queryByTestId("missing-mapping-alert");
    expect(alertIcon).toBeInTheDocument();
  });

  it("does NOT re-infer mappings when user clears a mapping manually", () => {
    // BUG: When user clears a mapping (e.g., user_input), then makes any change,
    // the mapping comes back because inference runs on every updateRunner.
    //
    // Expected: Inference should only run on addRunner/addDataset, not on updates.

    const runnerId = "runner-no-reinfer";

    // Step 1: Add runner with user_input (will be auto-inferred to input column)
    act(() => {
      useEvaluationsV3Store.getState().addRunner({
        id: runnerId,
        type: "prompt",
        name: "test-prompt",
        inputs: [{ identifier: "user_input", type: "str" }],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
      });
    });

    // Verify user_input was auto-inferred
    let storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;
    expect(storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input).toBeDefined();

    // Step 2: User manually clears the mapping
    act(() => {
      useEvaluationsV3Store.getState().removeRunnerMapping(runnerId, DEFAULT_TEST_DATA_ID, "user_input");
    });

    // Verify mapping was removed
    storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;
    expect(storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input).toBeUndefined();

    // Step 3: User makes some other change (e.g., updates localPromptConfig)
    // This should NOT re-infer the mapping!
    act(() => {
      useEvaluationsV3Store.getState().updateRunner(runnerId, {
        localPromptConfig: {
          llm: { model: "gpt-4" },
          messages: [{ role: "user", content: "Hello {{user_input}}" }],
          inputs: [{ identifier: "user_input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
        // Even though we pass inputs, it should NOT re-infer because user_input already existed
        inputs: [{ identifier: "user_input", type: "str" }],
      });
    });

    // Verify mapping is STILL removed - not re-inferred
    storeRunner = useEvaluationsV3Store.getState().runners.find(r => r.id === runnerId)!;
    expect(storeRunner.mappings[DEFAULT_TEST_DATA_ID]?.user_input).toBeUndefined();
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

// ============================================================================
// Tests: Evaluator validation with required/optional fields
// ============================================================================

const createTestEvaluator = (
  id: string,
  evaluatorType: string,
  inputs: Array<{ identifier: string; type: string }>,
  mappings: EvaluatorConfig["mappings"] = {}
): EvaluatorConfig => ({
  id,
  evaluatorType: evaluatorType as EvaluatorConfig["evaluatorType"],
  name: `Evaluator ${id}`,
  settings: {},
  inputs: inputs.map((i) => ({ ...i, type: i.type as "str" })),
  mappings,
});

describe("Evaluator validation with required/optional fields", () => {
  const runnerId = "runner-1";

  it("marks evaluator as valid when all required fields are mapped", () => {
    // langevals/llm_answer_match has requiredFields: ["output", "expected_output"], optionalFields: ["input"]
    const evaluator = createTestEvaluator(
      "eval-1",
      "langevals/llm_answer_match",
      [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
        { identifier: "input", type: "str" },
      ],
      {
        [DEFAULT_TEST_DATA_ID]: {
          [runnerId]: {
            output: { type: "source", source: "runner", sourceId: runnerId, sourceField: "output" },
            expected_output: { type: "source", source: "dataset", sourceId: DEFAULT_TEST_DATA_ID, sourceField: "expected_output" },
            // "input" is optional and not mapped - should still be valid
          },
        },
      }
    );

    const result = getEvaluatorMissingMappings(evaluator, DEFAULT_TEST_DATA_ID, runnerId);

    expect(result.isValid).toBe(true);
    expect(result.missingMappings.length).toBe(0);
  });

  it("marks evaluator as invalid when required field is missing", () => {
    // langevals/llm_answer_match has requiredFields: ["output", "expected_output"]
    const evaluator = createTestEvaluator(
      "eval-1",
      "langevals/llm_answer_match",
      [
        { identifier: "output", type: "str" },
        { identifier: "expected_output", type: "str" },
      ],
      {
        [DEFAULT_TEST_DATA_ID]: {
          [runnerId]: {
            output: { type: "source", source: "runner", sourceId: runnerId, sourceField: "output" },
            // "expected_output" is required but missing
          },
        },
      }
    );

    const result = getEvaluatorMissingMappings(evaluator, DEFAULT_TEST_DATA_ID, runnerId);

    expect(result.isValid).toBe(false);
    expect(result.missingMappings.length).toBe(1);
    expect(result.missingMappings[0]?.fieldId).toBe("expected_output");
    expect(result.missingMappings[0]?.isRequired).toBe(true);
  });

  it("marks evaluator as valid when only optional fields are unmapped (llm_boolean)", () => {
    // langevals/llm_boolean has requiredFields: [], optionalFields: ["input", "output", "contexts"]
    const evaluator = createTestEvaluator(
      "eval-1",
      "langevals/llm_boolean",
      [
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
        { identifier: "contexts", type: "str" },
      ],
      {
        [DEFAULT_TEST_DATA_ID]: {
          [runnerId]: {
            input: { type: "source", source: "dataset", sourceId: DEFAULT_TEST_DATA_ID, sourceField: "input" },
            output: { type: "source", source: "runner", sourceId: runnerId, sourceField: "output" },
            // "contexts" is optional and not mapped - should still be valid
          },
        },
      }
    );

    const result = getEvaluatorMissingMappings(evaluator, DEFAULT_TEST_DATA_ID, runnerId);

    expect(result.isValid).toBe(true);
    expect(result.missingMappings.length).toBe(0);
  });

  it("marks evaluator as invalid when ALL fields are empty (even if all optional)", () => {
    // langevals/llm_boolean has requiredFields: [], optionalFields: ["input", "output", "contexts"]
    const evaluator = createTestEvaluator(
      "eval-1",
      "langevals/llm_boolean",
      [
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
        { identifier: "contexts", type: "str" },
      ],
      {
        // No mappings at all
      }
    );

    const result = getEvaluatorMissingMappings(evaluator, DEFAULT_TEST_DATA_ID, runnerId);

    // Invalid because ALL fields are empty - need at least one mapping
    expect(result.isValid).toBe(false);
    // No missing "required" fields in missingMappings since none are required
    expect(result.missingMappings.length).toBe(0);
  });

  it("evaluatorHasMissingMappings returns false for valid evaluator with optional unmapped", () => {
    // langevals/llm_boolean with input and output mapped, contexts unmapped (optional)
    const evaluator = createTestEvaluator(
      "eval-1",
      "langevals/llm_boolean",
      [
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
        { identifier: "contexts", type: "str" },
      ],
      {
        [DEFAULT_TEST_DATA_ID]: {
          [runnerId]: {
            input: { type: "source", source: "dataset", sourceId: DEFAULT_TEST_DATA_ID, sourceField: "input" },
            output: { type: "source", source: "runner", sourceId: runnerId, sourceField: "output" },
          },
        },
      }
    );

    expect(evaluatorHasMissingMappings(evaluator, DEFAULT_TEST_DATA_ID, runnerId)).toBe(false);
  });

  it("evaluatorHasMissingMappings returns true when all fields empty", () => {
    const evaluator = createTestEvaluator(
      "eval-1",
      "langevals/llm_boolean",
      [
        { identifier: "input", type: "str" },
        { identifier: "output", type: "str" },
      ],
      {}
    );

    expect(evaluatorHasMissingMappings(evaluator, DEFAULT_TEST_DATA_ID, runnerId)).toBe(true);
  });
});
