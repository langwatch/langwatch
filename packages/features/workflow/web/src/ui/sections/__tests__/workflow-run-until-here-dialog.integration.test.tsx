/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatasetRecordEntry } from "@langwatch/dataset-contract";

const mockSetNode = vi.fn();
let mockNodes: unknown[] = [];

vi.mock("../../../behavior/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({
      nodes: mockNodes,
      setNode: mockSetNode,
      deselectAllNodes: vi.fn(),
      setPropertiesExpanded: vi.fn(),
    }),
}));

import { useRunUntilHereDialogStore } from "../../../behavior/use-run-until-here-dialog-store";
import {
  WorkflowRunUntilHereDialog,
  type WorkflowDatasetPreviewProps,
} from "../workflow-run-until-here-dialog";

const entryNode = (data?: Record<string, unknown>) => ({
  id: "entry-1",
  type: "entry",
  position: { x: 0, y: 0 },
  data: {
    name: "Entry point",
    outputs: [
      { identifier: "question", type: "str" },
      { identifier: "context", type: "str" },
    ],
    entry_selection: "first",
    train_size: 0.8,
    test_size: 0.2,
    seed: 42,
    dataset: { id: "ds-1", name: "qa-pairs" },
    ...data,
  },
});

const targetNode = {
  id: "node-7",
  type: "signature",
  position: { x: 100, y: 0 },
  data: { name: "Answer" },
};

const datasetRows: DatasetRecordEntry[] = [
  { id: "r1", question: "What is up?", context: "ctx-1" },
  { id: "r2", question: "Second question?", context: "ctx-2" },
];
const datasetColumns = [
  { name: "question", type: "string" },
  { name: "context", type: "string" },
] as never;

const stubDatasetPreview = ({ rows, onRowClick }: WorkflowDatasetPreviewProps) => (
  <div>
    {rows.map((row, index) => (
      <div key={row.id ?? index} onClick={() => onRowClick(index)}>
        {String(row.question)}
      </div>
    ))}
  </div>
);

function renderDialog({
  entryData,
  rows = datasetRows,
  onStartWorkflowExecution = vi.fn(),
}: {
  entryData?: Record<string, unknown>;
  rows?: DatasetRecordEntry[];
  onStartWorkflowExecution?: (input: unknown) => void;
} = {}) {
  mockNodes = [entryNode(entryData), targetNode];
  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <WorkflowRunUntilHereDialog
        datasetRows={rows}
        datasetColumns={rows.length > 0 ? datasetColumns : []}
        onStartWorkflowExecution={onStartWorkflowExecution}
        renderDatasetPreview={stubDatasetPreview}
      />
    </ChakraProvider>,
  );
  act(() => {
    useRunUntilHereDialogStore.getState().open("node-7");
  });
  return { ...utils, onStartWorkflowExecution };
}

describe("given the run-until-here dialog", () => {
  afterEach(() => {
    act(() => {
      useRunUntilHereDialogStore.getState().close();
    });
    cleanup();
    vi.clearAllMocks();
  });

  describe("when a node's Run workflow until here is clicked", () => {
    /** @scenario Run-until-here opens a dialog with one field per workflow input */
    it("opens with one field per entry input and Run and Cancel buttons", async () => {
      renderDialog();

      expect(await screen.findByTestId("run-until-here-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("run-until-here-input-question")).toBeInTheDocument();
      expect(screen.getByTestId("run-until-here-input-context")).toBeInTheDocument();
      expect(screen.getByTestId("run-until-here-run")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
    });
  });

  describe("when no values were submitted before", () => {
    /** @scenario Fields prefill from the first dataset row */
    it("prefills each field from the first dataset row", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByTestId("run-until-here-input-question")).toHaveValue("What is up?");
      });
      expect(screen.getByTestId("run-until-here-input-context")).toHaveValue("ctx-1");
    });
  });

  describe("when values were submitted before", () => {
    /** @scenario Fields prefill from the last submitted values */
    it("prefills from manual_run_values over the dataset row", async () => {
      renderDialog({
        entryData: { manual_run_values: { question: "manual Q", context: "manual C" } },
      });

      await waitFor(() => {
        expect(screen.getByTestId("run-until-here-input-question")).toHaveValue("manual Q");
      });
      expect(screen.getByTestId("run-until-here-input-context")).toHaveValue("manual C");
    });
  });

  describe("when Run is clicked with edited values", () => {
    /** @scenario Running executes until the target node with the typed values */
    it("starts the scoped execution with the typed values and persists them", async () => {
      const { onStartWorkflowExecution } = renderDialog();

      const questionInput = await screen.findByTestId("run-until-here-input-question");
      await waitFor(() => expect(questionInput).toHaveValue("What is up?"));
      fireEvent.change(questionInput, { target: { value: "edited question" } });
      fireEvent.click(screen.getByTestId("run-until-here-run"));

      expect(onStartWorkflowExecution).toHaveBeenCalledWith({
        untilNodeId: "node-7",
        inputs: [{ question: "edited question", context: "ctx-1" }],
      });
      const setNodeCall = mockSetNode.mock.calls.at(-1)![0] as {
        id: string;
        data: { manual_run_values?: Record<string, string> };
      };
      expect(setNodeCall.id).toBe("entry-1");
      expect(setNodeCall.data.manual_run_values).toEqual({
        question: "edited question",
        context: "ctx-1",
      });
      expect(useRunUntilHereDialogStore.getState().untilNodeId).toBeUndefined();
    });
  });

  describe("when Enter is pressed in a field", () => {
    /** @scenario Pressing Enter runs the partial execution */
    it("starts the scoped execution with the typed values", async () => {
      const { onStartWorkflowExecution } = renderDialog();

      const questionInput = await screen.findByTestId("run-until-here-input-question");
      await waitFor(() => expect(questionInput).toHaveValue("What is up?"));
      fireEvent.change(questionInput, { target: { value: "typed then enter" } });
      fireEvent.keyDown(questionInput, { key: "Enter" });

      expect(onStartWorkflowExecution).toHaveBeenCalledWith({
        untilNodeId: "node-7",
        inputs: [{ question: "typed then enter", context: "ctx-1" }],
      });
      expect(useRunUntilHereDialogStore.getState().untilNodeId).toBeUndefined();
    });
  });

  describe("when the entry point has no dataset attached", () => {
    /** @scenario Select dataset value is only offered with an attached dataset */
    it("offers no Select dataset value button", async () => {
      renderDialog({ entryData: { dataset: undefined }, rows: [] });

      await screen.findByTestId("run-until-here-dialog");
      expect(screen.queryByTestId("select-dataset-value")).not.toBeInTheDocument();
    });
  });

  describe("when Select dataset value is clicked", () => {
    /** @scenario Selecting a dataset row to run with */
    it("shows the dataset table, selects a row on click, and Cancel returns to the fields", async () => {
      renderDialog();

      fireEvent.click(await screen.findByTestId("select-dataset-value"));

      expect(await screen.findByText("Second question?")).toBeInTheDocument();
      expect(screen.queryByTestId("run-with-selected-row")).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("Second question?"));
      expect(await screen.findByTestId("run-with-selected-row")).toBeInTheDocument();

      fireEvent.click(screen.getByText("Cancel"));
      expect(await screen.findByTestId("run-until-here-input-question")).toBeInTheDocument();
      expect(screen.queryByTestId("run-with-selected-row")).not.toBeInTheDocument();
    });

    /** @scenario Running with a selected row uses that row's values */
    it("runs with the selected row's values and remembers them", async () => {
      const { onStartWorkflowExecution } = renderDialog();

      fireEvent.click(await screen.findByTestId("select-dataset-value"));
      fireEvent.click(await screen.findByText("Second question?"));
      fireEvent.click(await screen.findByTestId("run-with-selected-row"));

      expect(onStartWorkflowExecution).toHaveBeenCalledWith({
        untilNodeId: "node-7",
        inputs: [{ question: "Second question?", context: "ctx-2" }],
      });
      const setNodeCall = mockSetNode.mock.calls.at(-1)![0] as {
        data: { manual_run_values?: Record<string, string> };
      };
      expect(setNodeCall.data.manual_run_values).toEqual({
        question: "Second question?",
        context: "ctx-2",
      });
      expect(useRunUntilHereDialogStore.getState().untilNodeId).toBeUndefined();
    });
  });

  describe("given a saved dataset whose rows arrive as a fresh array reference on every render", () => {
    /** @scenario Opening run-until-here with a saved dataset does not loop */
    it("settles without exceeding the maximum render depth and prefills the first row", async () => {
      mockNodes = [entryNode(), targetNode];

      function ChurningWrapper() {
        // A fresh array literal every render reproduces the churn a hook
        // returning a new reference each call would feed the dialog.
        return (
          <ChakraProvider value={defaultSystem}>
            <WorkflowRunUntilHereDialog
              datasetRows={[{ id: "r1", question: "What is up?", context: "ctx-1" }]}
              datasetColumns={datasetColumns}
              onStartWorkflowExecution={vi.fn()}
              renderDatasetPreview={stubDatasetPreview}
            />
          </ChakraProvider>
        );
      }

      const { rerender } = render(<ChurningWrapper />);
      act(() => {
        useRunUntilHereDialogStore.getState().open("node-7");
      });

      expect(() => {
        for (let i = 0; i < 5; i++) rerender(<ChurningWrapper />);
      }).not.toThrow();

      await waitFor(() => {
        expect(screen.getByTestId("run-until-here-input-question")).toHaveValue("What is up?");
      });
    });
  });
});
