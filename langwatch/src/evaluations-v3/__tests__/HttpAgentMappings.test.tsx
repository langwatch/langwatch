/**
 * Tests for HTTP agent mappings in Evaluations V3.
 *
 * Feature: HTTP agent support for Evaluations V3
 * Scenarios: Lines 53-72 of specs/evaluations-v3/http-agent-support.feature
 *
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock useLatestPromptVersion to avoid needing SessionProvider
vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

import { TargetHeader } from "../components/TargetSection/TargetHeader";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import type { DatasetReference, TargetConfig } from "../types";
import { DEFAULT_TEST_DATA_ID } from "../types";
import {
  getTargetMissingMappings,
  targetHasMissingMappings,
} from "../utils/mappingValidation";
import { extractVariablesFromBodyTemplate } from "../utils/httpAgentUtils";

const createTestDataset = (
  id: string = DEFAULT_TEST_DATA_ID,
  name = "Test Data",
  columns: Array<{ name: string; type: "string" | "number" | "boolean" }> = [
    { name: "input", type: "string" },
    { name: "expected_output", type: "string" },
  ],
): DatasetReference => ({
  id,
  name,
  type: "inline",
  columns: columns.map((c) => ({ id: c.name, ...c })),
});

/**
 * Create an HTTP agent target for testing.
 */
const createHttpAgentTarget = (
  id: string,
  inputs: Array<{ identifier: string; type: string }>,
  bodyTemplate: string,
  mappings: TargetConfig["mappings"] = {},
): TargetConfig => ({
  id,
  type: "agent",
  agentType: "http",
  name: `HTTP Agent ${id}`,
  inputs: inputs.map((i) => ({ ...i, type: i.type as "str" })),
  outputs: [{ identifier: "output", type: "str" }],
  mappings,
  httpConfig: {
    url: "https://api.example.com/chat",
    method: "POST",
    bodyTemplate,
    outputPath: "$.result",
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
// Tests: extractVariablesFromBodyTemplate utility
// ============================================================================

describe("extractVariablesFromBodyTemplate", () => {
  it("extracts variables from body template with mustache syntax", () => {
    const bodyTemplate = `{
      "thread_id": "{{thread_id}}",
      "messages": {{messages}}
    }`;
    const variables = extractVariablesFromBodyTemplate(bodyTemplate);
    expect(variables).toContain("thread_id");
    expect(variables).toContain("messages");
    expect(variables.length).toBe(2);
  });

  it("extracts single variable from simple template", () => {
    const bodyTemplate = `{"input": "{{input}}"}`;
    const variables = extractVariablesFromBodyTemplate(bodyTemplate);
    expect(variables).toEqual(["input"]);
  });

  it("returns empty array for template without variables", () => {
    const bodyTemplate = `{"message": "Hello world"}`;
    const variables = extractVariablesFromBodyTemplate(bodyTemplate);
    expect(variables).toEqual([]);
  });

  it("handles duplicate variables (returns unique list)", () => {
    const bodyTemplate = `{
      "first": "{{input}}",
      "second": "{{input}}"
    }`;
    const variables = extractVariablesFromBodyTemplate(bodyTemplate);
    expect(variables).toEqual(["input"]);
  });

  it("extracts complex variable names with underscores", () => {
    const bodyTemplate = `{
      "thread_id": "{{thread_id}}",
      "user_message": "{{user_message}}",
      "context_data": {{context_data}}
    }`;
    const variables = extractVariablesFromBodyTemplate(bodyTemplate);
    expect(variables).toContain("thread_id");
    expect(variables).toContain("user_message");
    expect(variables).toContain("context_data");
    expect(variables.length).toBe(3);
  });
});

// ============================================================================
// Scenario: HTTP agent target shows input mapping section
// ============================================================================

describe("HTTP agent target shows input mapping section", () => {
  it("shows thread_id and input as mappable inputs", () => {
    const bodyTemplate = `{
      "thread_id": "{{thread_id}}",
      "input": "{{input}}"
    }`;
    const variables = extractVariablesFromBodyTemplate(bodyTemplate);

    expect(variables).toContain("thread_id");
    expect(variables).toContain("input");
  });

  it("validates HTTP agent inputs against mappings", () => {
    const target = createHttpAgentTarget(
      "http-1",
      [
        { identifier: "thread_id", type: "str" },
        { identifier: "input", type: "str" },
      ],
      `{"thread_id": "{{thread_id}}", "input": "{{input}}"}`,
      {},
    );

    const result = getTargetMissingMappings(target, DEFAULT_TEST_DATA_ID);

    // HTTP agents require at least one mapping, none provided = invalid
    expect(result.isValid).toBe(false);
    // Both fields are listed as missing but marked as NOT required (optional)
    expect(result.missingMappings.length).toBe(2);
    expect(result.missingMappings.map((m) => m.fieldId)).toContain("thread_id");
    expect(result.missingMappings.map((m) => m.fieldId)).toContain("input");
    // HTTP agent fields are optional (not individually required)
    expect(result.missingMappings.every((m) => !m.isRequired)).toBe(true);
  });

  it("is valid when at least one HTTP agent input is mapped", () => {
    const target = createHttpAgentTarget(
      "http-partial",
      [
        { identifier: "thread_id", type: "str" },
        { identifier: "input", type: "str" },
        { identifier: "messages", type: "str" },
      ],
      `{"thread_id": "{{thread_id}}", "input": "{{input}}", "messages": {{messages}}}`,
      {
        [DEFAULT_TEST_DATA_ID]: {
          // Only input is mapped, thread_id and messages are not
          input: {
            type: "source",
            source: "dataset",
            sourceId: DEFAULT_TEST_DATA_ID,
            sourceField: "input",
          },
        },
      },
    );

    const result = getTargetMissingMappings(target, DEFAULT_TEST_DATA_ID);

    // Valid because at least one field is mapped
    expect(result.isValid).toBe(true);
    // Two fields are still missing but that's OK for HTTP agents
    expect(result.missingMappings.length).toBe(2);
  });

  it("accepts value mappings for HTTP agent inputs", () => {
    const target = createHttpAgentTarget(
      "http-1",
      [
        { identifier: "thread_id", type: "str" },
        { identifier: "input", type: "str" },
      ],
      `{"thread_id": "{{thread_id}}", "input": "{{input}}"}`,
      {
        [DEFAULT_TEST_DATA_ID]: {
          thread_id: {
            type: "value",
            value: "fixed-thread-123",
          },
          input: {
            type: "source",
            source: "dataset",
            sourceId: DEFAULT_TEST_DATA_ID,
            sourceField: "input",
          },
        },
      },
    );

    const result = getTargetMissingMappings(target, DEFAULT_TEST_DATA_ID);
    expect(result.isValid).toBe(true);
    expect(result.missingMappings.length).toBe(0);
  });
});

// ============================================================================
// Scenario: HTTP agent mappings auto-infer from dataset columns
// ============================================================================

describe("HTTP agent mappings auto-infer from dataset columns", () => {
  it("auto-infers thread_id mapping when dataset has matching column", () => {
    // Create dataset with thread_id column
    act(() => {
      useEvaluationsV3Store.getState().addDataset({
        id: "dataset-with-thread-id",
        name: "Thread Dataset",
        type: "inline",
        columns: [
          { id: "input", name: "input", type: "string" },
          { id: "expected_output", name: "expected_output", type: "string" },
          { id: "thread_id", name: "thread_id", type: "string" },
        ],
      });
      useEvaluationsV3Store.getState().setActiveDataset("dataset-with-thread-id");
    });

    // Add HTTP agent target - addTarget should auto-infer mappings
    const targetId = "http-auto-infer";
    act(() => {
      useEvaluationsV3Store.getState().addTarget({
        id: targetId,
        type: "agent",
        agentType: "http",
        name: "HTTP Agent",
        inputs: [
          { identifier: "thread_id", type: "str" },
          { identifier: "input", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
        httpConfig: {
          url: "https://api.example.com/chat",
          method: "POST",
          bodyTemplate: `{"thread_id": "{{thread_id}}", "input": "{{input}}"}`,
          outputPath: "$.result",
        },
      });
    });

    // Get the target from store
    const target = useEvaluationsV3Store
      .getState()
      .targets.find((t) => t.id === targetId)!;

    // thread_id should be auto-mapped to thread_id column (exact match)
    const threadIdMapping = target.mappings["dataset-with-thread-id"]?.thread_id;
    expect(threadIdMapping).toBeDefined();
    expect(threadIdMapping?.type).toBe("source");
    if (threadIdMapping?.type === "source") {
      expect(threadIdMapping.sourceField).toBe("thread_id");
    }

    // input should be auto-mapped to input column
    const inputMapping = target.mappings["dataset-with-thread-id"]?.input;
    expect(inputMapping).toBeDefined();
    expect(inputMapping?.type).toBe("source");
    if (inputMapping?.type === "source") {
      expect(inputMapping.sourceField).toBe("input");
    }
  });

  it("does not auto-infer when no matching column exists", () => {
    // Create dataset without matching columns
    act(() => {
      useEvaluationsV3Store.getState().addDataset({
        id: "dataset-no-match",
        name: "No Match Dataset",
        type: "inline",
        columns: [
          { id: "foo", name: "foo", type: "string" },
          { id: "bar", name: "bar", type: "string" },
        ],
      });
      useEvaluationsV3Store.getState().setActiveDataset("dataset-no-match");
    });

    // Add HTTP agent target
    const targetId = "http-no-match";
    act(() => {
      useEvaluationsV3Store.getState().addTarget({
        id: targetId,
        type: "agent",
        agentType: "http",
        name: "HTTP Agent",
        inputs: [
          { identifier: "custom_field", type: "str" },
        ],
        outputs: [{ identifier: "output", type: "str" }],
        mappings: {},
        httpConfig: {
          url: "https://api.example.com/chat",
          method: "POST",
          bodyTemplate: `{"custom_field": "{{custom_field}}"}`,
          outputPath: "$.result",
        },
      });
    });

    // Get the target from store
    const target = useEvaluationsV3Store
      .getState()
      .targets.find((t) => t.id === targetId)!;

    // custom_field should NOT be mapped (no matching column)
    const customFieldMapping = target.mappings["dataset-no-match"]?.custom_field;
    expect(customFieldMapping).toBeUndefined();

    // Validation should detect missing mapping
    const hasMissing = targetHasMissingMappings(target, "dataset-no-match");
    expect(hasMissing).toBe(true);
  });
});

// ============================================================================
// Scenario: Missing HTTP agent mappings show alert on target chip
// ============================================================================

describe("Missing HTTP agent mappings show alert on target chip", () => {
  it("shows alert icon when HTTP agent has unmapped required input", () => {
    const target = createHttpAgentTarget(
      "http-missing",
      [{ identifier: "messages", type: "str" }],
      `{"messages": {{messages}}}`,
      {}, // No mappings
    );

    renderWithProviders(
      <TargetHeader
        target={target}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    // Alert icon should be present
    expect(screen.getByTestId("missing-mapping-alert")).toBeInTheDocument();
  });

  it("does not show alert when all HTTP agent inputs are mapped", () => {
    const target = createHttpAgentTarget(
      "http-complete",
      [{ identifier: "messages", type: "str" }],
      `{"messages": {{messages}}}`,
      {
        [DEFAULT_TEST_DATA_ID]: {
          messages: {
            type: "source",
            source: "dataset",
            sourceId: DEFAULT_TEST_DATA_ID,
            sourceField: "input",
          },
        },
      },
    );

    renderWithProviders(
      <TargetHeader
        target={target}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    // Alert icon should NOT be present
    expect(screen.queryByTestId("missing-mapping-alert")).not.toBeInTheDocument();
  });

  it("calls onEdit when play button is clicked with missing mappings", () => {
    const target = createHttpAgentTarget(
      "http-missing-play",
      [{ identifier: "messages", type: "str" }],
      `{"messages": {{messages}}}`,
      {}, // No mappings
    );
    const onEdit = vi.fn();
    const onRun = vi.fn();

    renderWithProviders(
      <TargetHeader
        target={target}
        onEdit={onEdit}
        onRemove={vi.fn()}
        onRun={onRun}
      />,
    );

    // Click play button
    const playButton = screen.getByTestId("target-play-button");
    playButton.click();

    // Should call onEdit (to open mappings drawer) instead of onRun
    expect(onEdit).toHaveBeenCalledWith(target);
    expect(onRun).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Integration: HTTP agent vs code agent validation differences
// ============================================================================

describe("HTTP agent has different validation than code agent", () => {
  it("HTTP agent is valid with partial mappings, code agent requires all", () => {
    // HTTP agent target with partial mappings (only 'input' mapped)
    const httpTarget = createHttpAgentTarget(
      "http-target",
      [
        { identifier: "input", type: "str" },
        { identifier: "context", type: "str" },
      ],
      `{"input": "{{input}}", "context": "{{context}}"}`,
      {
        [DEFAULT_TEST_DATA_ID]: {
          input: {
            type: "source",
            source: "dataset",
            sourceId: DEFAULT_TEST_DATA_ID,
            sourceField: "input",
          },
          // context is NOT mapped
        },
      },
    );

    // Code agent target with same partial mappings
    const codeTarget: TargetConfig = {
      id: "code-target",
      type: "agent",
      agentType: "code",
      name: "Code Agent",
      inputs: [
        { identifier: "input", type: "str" },
        { identifier: "context", type: "str" },
      ],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {
        [DEFAULT_TEST_DATA_ID]: {
          input: {
            type: "source",
            source: "dataset",
            sourceId: DEFAULT_TEST_DATA_ID,
            sourceField: "input",
          },
          // context is NOT mapped
        },
      },
    };

    const httpResult = getTargetMissingMappings(httpTarget, DEFAULT_TEST_DATA_ID);
    const codeResult = getTargetMissingMappings(codeTarget, DEFAULT_TEST_DATA_ID);

    // HTTP agent is valid (at least one mapping)
    expect(httpResult.isValid).toBe(true);

    // Code agent is invalid (all fields required)
    expect(codeResult.isValid).toBe(false);
  });

  it("both are invalid with no mappings", () => {
    const httpTarget = createHttpAgentTarget(
      "http-target",
      [{ identifier: "input", type: "str" }],
      `{"input": "{{input}}"}`,
      {},
    );

    const codeTarget: TargetConfig = {
      id: "code-target",
      type: "agent",
      agentType: "code",
      name: "Code Agent",
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
      mappings: {},
    };

    const httpResult = getTargetMissingMappings(httpTarget, DEFAULT_TEST_DATA_ID);
    const codeResult = getTargetMissingMappings(codeTarget, DEFAULT_TEST_DATA_ID);

    // Both invalid with no mappings
    expect(httpResult.isValid).toBe(false);
    expect(codeResult.isValid).toBe(false);
  });
});
