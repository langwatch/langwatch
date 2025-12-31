/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunnerVariablesPanel } from "../RunnerVariablesPanel";
import type { RunnerConfig, DatasetReference } from "../../../types";

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

const mockRunner: RunnerConfig = {
  id: "runner-1",
  type: "prompt",
  name: "GPT-4o Prompt",
  inputs: [
    { identifier: "question", type: "str" },
    { identifier: "context", type: "str" },
  ],
  outputs: [{ identifier: "answer", type: "str" }],
  mappings: {
    question: {
      source: "dataset",
      sourceId: "dataset-1",
      sourceField: "input_text",
    },
  },
  evaluatorIds: [],
};

const mockOtherRunner: RunnerConfig = {
  id: "runner-2",
  type: "prompt",
  name: "Web Search",
  inputs: [{ identifier: "query", type: "str" }],
  outputs: [{ identifier: "search_results", type: "str" }],
  mappings: {},
  evaluatorIds: [],
};

const renderComponent = (
  props: Partial<Parameters<typeof RunnerVariablesPanel>[0]> = {}
) => {
  const defaultProps = {
    runner: mockRunner,
    datasets: mockDatasets,
    otherRunners: [],
    onInputsChange: vi.fn(),
    onMappingsChange: vi.fn(),
  };

  return render(
    <ChakraProvider value={defaultSystem}>
      <RunnerVariablesPanel {...defaultProps} {...props} />
    </ChakraProvider>
  );
};

describe("RunnerVariablesPanel", () => {
  afterEach(() => {
    cleanup();
  });

  describe("rendering", () => {
    it("displays Input Variables title", () => {
      renderComponent();
      expect(screen.getByText("Input Variables")).toBeInTheDocument();
    });

    it("shows runner input variables", () => {
      renderComponent();
      expect(screen.getByText("question")).toBeInTheDocument();
      expect(screen.getByText("context")).toBeInTheDocument();
    });

    it("shows mapped variable value", () => {
      renderComponent();
      // The mapped field should show in the mapping input
      expect(screen.getByDisplayValue("Test Dataset.input_text")).toBeInTheDocument();
    });

    it("shows helper text", () => {
      renderComponent();
      expect(
        screen.getByText(/Connect each input variable to a data source/i)
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
      const fullyMappedRunner: RunnerConfig = {
        ...mockRunner,
        mappings: {
          question: {
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "input_text",
          },
          context: {
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "expected_output",
          },
        },
      };

      renderComponent({ runner: fullyMappedRunner });
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
        (input) => !(input as HTMLInputElement).value
      );
      if (emptyInput) {
        await user.click(emptyInput);

        await waitFor(() => {
          expect(screen.getByText("Test Dataset")).toBeInTheDocument();
        });
      }
    });

    it("includes other runners as mapping sources", async () => {
      const user = userEvent.setup();
      renderComponent({ otherRunners: [mockOtherRunner] });

      // Click on an empty mapping input
      const inputs = screen.getAllByRole("textbox");
      const emptyInput = inputs.find(
        (input) => !(input as HTMLInputElement).value
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
    it("calls onMappingsChange when mapping is selected", async () => {
      const user = userEvent.setup();
      const onMappingsChange = vi.fn();
      renderComponent({ onMappingsChange });

      // Find the unmapped input (context)
      const inputs = screen.getAllByRole("textbox");
      const emptyInput = inputs.find(
        (input) => !(input as HTMLInputElement).value
      );

      if (emptyInput) {
        await user.click(emptyInput);

        await waitFor(() => {
          expect(screen.getByText("expected_output")).toBeInTheDocument();
        });

        await user.click(screen.getByText("expected_output"));

        expect(onMappingsChange).toHaveBeenCalledWith({
          question: {
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "input_text",
          },
          context: {
            source: "dataset",
            sourceId: "dataset-1",
            sourceField: "expected_output",
          },
        });
      }
    });
  });

  describe("readOnly mode", () => {
    it("hides helper text in readOnly mode", () => {
      renderComponent({ readOnly: true });
      expect(
        screen.queryByText(/Connect each input variable to a data source/i)
      ).not.toBeInTheDocument();
    });
  });
});
