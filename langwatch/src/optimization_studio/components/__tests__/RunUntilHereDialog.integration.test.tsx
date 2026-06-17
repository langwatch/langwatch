/**
 * @vitest-environment jsdom
 *
 * Integration tests for the run-until-here dialog: opening from the
 * node menu store, prefill priority (last submitted values over first
 * dataset row), running with typed values, and the select-dataset-row
 * flow on the real DatasetPreviewTable.
 *
 * UX contract: specs/workflows/run-until-here-dialog.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockNodes, mockSetNode, mockStartWorkflowExecution, mockDatasetData } =
  vi.hoisted(() => ({
    mockNodes: { current: [] as unknown[] },
    mockSetNode: vi.fn(),
    mockStartWorkflowExecution: vi.fn(),
    mockDatasetData: {
      current: {
        rows: [] as Record<string, unknown>[],
        columns: [] as unknown[],
      },
    },
  }));

vi.mock("../../hooks/useWorkflowStore", () => ({
  useWorkflowStore: (selector: (s: unknown) => unknown) =>
    selector({
      nodes: mockNodes.current,
      setNode: mockSetNode,
      deselectAllNodes: vi.fn(),
      setPropertiesExpanded: vi.fn(),
    }),
}));

vi.mock("../../hooks/useWorkflowExecution", () => ({
  useWorkflowExecution: () => ({
    startWorkflowExecution: mockStartWorkflowExecution,
  }),
}));

vi.mock("../../hooks/useGetDatasetData", () => ({
  useGetDatasetData: () => ({
    rows: mockDatasetData.current.rows,
    columns: mockDatasetData.current.columns,
    query: {},
    total: mockDatasetData.current.rows.length,
  }),
}));

vi.mock("../nodes/Nodes", () => ({
  getNodeDisplayName: (node: { id: string; data: { name?: string } }) =>
    node.data.name ?? node.id,
}));

const { RunUntilHereDialog } = await import("../RunUntilHereDialog");
const { useRunUntilHereDialogStore } = await import(
  "../../hooks/useRunUntilHereDialogStore"
);

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

const datasetRows = [
  { id: "r1", question: "What is up?", context: "ctx-1" },
  { id: "r2", question: "Second question?", context: "ctx-2" },
];
const datasetColumns = [
  { name: "question", type: "string" },
  { name: "context", type: "string" },
];

function renderDialog({
  entryData,
  rows = datasetRows,
}: {
  entryData?: Record<string, unknown>;
  rows?: typeof datasetRows;
} = {}) {
  mockNodes.current = [entryNode(entryData), targetNode];
  mockDatasetData.current = {
    rows,
    columns: rows.length > 0 ? datasetColumns : [],
  };
  const utils = render(
    <ChakraProvider value={defaultSystem}>
      <RunUntilHereDialog />
    </ChakraProvider>,
  );
  act(() => {
    useRunUntilHereDialogStore.getState().open("node-7");
  });
  return utils;
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

      expect(
        await screen.findByTestId("run-until-here-dialog"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("run-until-here-input-question"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("run-until-here-input-context"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("run-until-here-run")).toBeInTheDocument();
      expect(screen.getByText("Cancel")).toBeInTheDocument();
      expect(mockStartWorkflowExecution).not.toHaveBeenCalled();
    });
  });

  describe("when no values were submitted before", () => {
    /** @scenario Fields prefill from the first dataset row */
    it("prefills each field from the first dataset row", async () => {
      renderDialog();

      await waitFor(() => {
        expect(screen.getByTestId("run-until-here-input-question")).toHaveValue(
          "What is up?",
        );
      });
      expect(screen.getByTestId("run-until-here-input-context")).toHaveValue(
        "ctx-1",
      );
    });
  });

  describe("when values were submitted before", () => {
    /** @scenario Fields prefill from the last submitted values */
    it("prefills from manual_run_values over the dataset row", async () => {
      renderDialog({
        entryData: {
          manual_run_values: { question: "manual Q", context: "manual C" },
        },
      });

      await waitFor(() => {
        expect(screen.getByTestId("run-until-here-input-question")).toHaveValue(
          "manual Q",
        );
      });
      expect(screen.getByTestId("run-until-here-input-context")).toHaveValue(
        "manual C",
      );
    });
  });

  describe("when Run is clicked with edited values", () => {
    /** @scenario Running executes until the target node with the typed values */
    it("starts the scoped execution with the typed values and persists them", async () => {
      renderDialog();

      const questionInput = await screen.findByTestId(
        "run-until-here-input-question",
      );
      await waitFor(() => {
        expect(questionInput).toHaveValue("What is up?");
      });
      fireEvent.change(questionInput, { target: { value: "edited question" } });
      fireEvent.click(screen.getByTestId("run-until-here-run"));

      expect(mockStartWorkflowExecution).toHaveBeenCalledWith({
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

  describe("when the entry point has no dataset attached", () => {
    /** @scenario Select dataset value is only offered with an attached dataset */
    it("offers no Select dataset value button", async () => {
      renderDialog({ entryData: { dataset: undefined }, rows: [] });

      await screen.findByTestId("run-until-here-dialog");
      expect(
        screen.queryByTestId("select-dataset-value"),
      ).not.toBeInTheDocument();
    });
  });

  describe("when Select dataset value is clicked", () => {
    /** @scenario Selecting a dataset row to run with */
    it("shows the dataset table, selects a row on click, and Cancel returns to the fields", async () => {
      renderDialog();

      fireEvent.click(await screen.findByTestId("select-dataset-value"));

      expect(await screen.findByText("Second question?")).toBeInTheDocument();
      expect(
        screen.queryByTestId("run-with-selected-row"),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByText("Second question?"));
      expect(
        await screen.findByTestId("run-with-selected-row"),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByText("Cancel"));
      expect(
        await screen.findByTestId("run-until-here-input-question"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("run-with-selected-row"),
      ).not.toBeInTheDocument();
    });

    /** @scenario Running with a selected row uses that row's values */
    it("runs with the selected row's values and remembers them", async () => {
      renderDialog();

      fireEvent.click(await screen.findByTestId("select-dataset-value"));
      fireEvent.click(await screen.findByText("Second question?"));
      fireEvent.click(await screen.findByTestId("run-with-selected-row"));

      expect(mockStartWorkflowExecution).toHaveBeenCalledWith({
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
});
