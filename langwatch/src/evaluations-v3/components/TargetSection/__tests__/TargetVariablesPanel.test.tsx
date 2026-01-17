/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatasetReference, TargetConfig } from "../../../types";
import { TargetVariablesPanel } from "../../TargetSection/TargetVariablesPanel";

// Mock components with complex dependencies
vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
}));

vi.mock("~/optimization_studio/components/nodes/Nodes", () => ({
  TypeLabel: ({ type }: { type: string }) => <span>{type}</span>,
}));

const mockDatasets: DatasetReference[] = [
  {
    id: "dataset-1",
    name: "Test Dataset",
    type: "inline",
    columns: [
      { id: "col-1", name: "input_text", type: "string" },
      { id: "col-2", name: "expected_output", type: "string" },
    ],
  },
];

const ACTIVE_DATASET_ID = "dataset-1";

const mockTarget: TargetConfig = {
  id: "target-1",
  type: "prompt",
  name: "GPT-4o Prompt",
  inputs: [
    { identifier: "question", type: "str" },
    { identifier: "context", type: "str" },
  ],
  outputs: [{ identifier: "answer", type: "str" }],
  // Per-dataset mappings: datasetId -> inputField -> FieldMapping
  mappings: {
    [ACTIVE_DATASET_ID]: {
      question: {
        type: "source",
        source: "dataset",
        sourceId: "dataset-1",
        sourceField: "input_text",
      },
    },
  },
  // localPromptConfig is needed to determine which fields are actually used
  localPromptConfig: {
    llm: { model: "gpt-4" },
    messages: [
      {
        role: "user",
        content: "Answer this: {{question}} with context: {{context}}",
      },
    ],
    inputs: [
      { identifier: "question", type: "str" },
      { identifier: "context", type: "str" },
    ],
    outputs: [{ identifier: "answer", type: "str" }],
  },
};

const mockOtherTarget: TargetConfig = {
  id: "target-2",
  type: "prompt",
  name: "Web Search",
  inputs: [{ identifier: "query", type: "str" }],
  outputs: [{ identifier: "search_results", type: "str" }],
  mappings: {},
};

const renderComponent = (
  props: Partial<Parameters<typeof TargetVariablesPanel>[0]> = {},
) => {
  const defaultProps = {
    target: mockTarget,
    activeDatasetId: ACTIVE_DATASET_ID,
    datasets: mockDatasets,
    otherTargets: [],
    onInputsChange: vi.fn(),
    onMappingChange: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <TargetVariablesPanel {...defaultProps} {...props} />
    </ChakraProvider>,
  );
};

describe("TargetVariablesPanel", () => {
  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("displays Input Variables title", () => {
      renderComponent();
      expect(screen.getByText("Input Variables")).toBeInTheDocument();
    });

    it("shows target input variables", () => {
      renderComponent();
      expect(screen.getByText("question")).toBeInTheDocument();
      expect(screen.getByText("context")).toBeInTheDocument();
    });

    it("shows mapped variable as a tag", () => {
      renderComponent();
      // The mapped field should show as a closable tag with just the field name
      expect(screen.getByTestId("source-mapping-tag")).toBeInTheDocument();
      expect(screen.getByText("input_text")).toBeInTheDocument();
    });

    it("shows helper text", () => {
      renderComponent();
      expect(
        screen.getByText(/Connect each input variable to a data source/i),
      ).toBeInTheDocument();
    });
  });

  describe("missing mappings warning", () => {
    it("shows warning when inputs are not mapped", () => {
      renderComponent();
      // context is not mapped
      const warning = screen.getByText(/1 input not mapped/i);
      expect(warning).toBeInTheDocument();
      // The warning text should contain "context"
      expect(warning.textContent).toContain("context");
    });

    it("does not show warning when all inputs are mapped", () => {
      const fullyMappedTarget: TargetConfig = {
        ...mockTarget,
        // Per-dataset mappings
        mappings: {
          [ACTIVE_DATASET_ID]: {
            question: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "input_text",
            },
            context: {
              type: "source",
              source: "dataset",
              sourceId: "dataset-1",
              sourceField: "expected_output",
            },
          },
        },
      };

      renderComponent({ target: fullyMappedTarget });
      expect(screen.queryByText(/input.*not mapped/i)).not.toBeInTheDocument();
    });

    it("hides warning in readOnly mode", () => {
      renderComponent({ readOnly: true });
      expect(screen.queryByText(/input.*not mapped/i)).not.toBeInTheDocument();
    });
  });

  describe("available sources", () => {
    it("includes datasets as mapping sources", async () => {
      const user = userEvent.setup();
      renderComponent();

      // Find the mapping input for "context" (the unmapped one)
      const inputs = screen.getAllByRole("textbox");
      // Click on an empty mapping input to open dropdown
      const emptyInput = inputs.find(
        (input) => !(input as HTMLInputElement).value,
      );
      if (emptyInput) {
        await user.click(emptyInput);

        await waitFor(() => {
          expect(screen.getByText("Test Dataset")).toBeInTheDocument();
        });
      }
    });

    it("includes other targets as mapping sources", async () => {
      const user = userEvent.setup();
      renderComponent({ otherTargets: [mockOtherTarget] });

      // Click on an empty mapping input
      const inputs = screen.getAllByRole("textbox");
      const emptyInput = inputs.find(
        (input) => !(input as HTMLInputElement).value,
      );
      if (emptyInput) {
        await user.click(emptyInput);

        await waitFor(() => {
          expect(screen.getByText("Web Search")).toBeInTheDocument();
          expect(screen.getByText("search_results")).toBeInTheDocument();
        });
      }
    });
  });

  describe("callbacks", () => {
    it("calls onMappingChange when mapping is selected", async () => {
      const user = userEvent.setup();
      const onMappingChange = vi.fn();
      renderComponent({ onMappingChange });

      // Find the inputs - with the new Tag UI, the mapped variable (question) shows
      // a tag + empty input, while unmapped variable (context) shows just empty input
      // We need to click the input that doesn't have a tag next to it
      const inputs = screen.getAllByRole("textbox");

      // The second input should be for "context" (unmapped variable)
      const contextInput = inputs[1];
      expect(contextInput).toBeDefined();

      await user.click(contextInput!);

      await waitFor(() => {
        expect(screen.getByText("expected_output")).toBeInTheDocument();
      });

      await user.click(screen.getByText("expected_output"));

      // The callback should be called with the field name and mapping
      // onMappingChange(inputField, mapping | undefined)
      expect(onMappingChange).toHaveBeenCalledWith(
        "context",
        expect.objectContaining({
          type: "source",
          sourceId: "dataset-1",
          sourceField: "expected_output",
        }),
      );
    });
  });

  describe("readOnly mode", () => {
    it("hides helper text in readOnly mode", () => {
      renderComponent({ readOnly: true });
      expect(
        screen.queryByText(/Connect each input variable to a data source/i),
      ).not.toBeInTheDocument();
    });
  });
});
