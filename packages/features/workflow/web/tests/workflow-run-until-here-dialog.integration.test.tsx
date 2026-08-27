/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import type { Component, Entry } from "@langwatch/workflow-contract";
import {
  getWorkflowEntryNode,
  type WorkflowDatasetPreviewProps,
  type WorkflowPartialExecutionInput,
  WorkflowRunUntilHereDialog,
  useRunUntilHereDialogStore,
} from "@langwatch/workflow-web";
import { _useWorkflowStore } from "../src/hooks/use-workflow-store";

const datasetRows: DatasetRecordEntry[] = [
  { id: "r1", question: "What is up?", context: "ctx-1" },
  { id: "r2", question: "Second question?", context: "ctx-2" },
];

const datasetColumns: DatasetColumns = [
  { name: "question", type: "string" },
  { name: "context", type: "string" },
];

const startWorkflowExecution = vi.fn<(input: WorkflowPartialExecutionInput) => void>();

function makeEntryNode(overrides: Partial<Entry> = {}): Node<Entry> {
  return {
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
      ...overrides,
    },
  };
}

const targetNode: Node<Component> = {
  id: "node-7",
  type: "signature",
  position: { x: 100, y: 0 },
  data: { name: "Answer" },
};

function DatasetPreview({ rows, onRowClick }: WorkflowDatasetPreviewProps) {
  return (
    <div>
      {rows.map((row, index) => (
        <button key={row.id} type="button" onClick={() => onRowClick(index)}>
          {String(row.question)}
        </button>
      ))}
    </div>
  );
}

function expectInputValue(element: HTMLElement, value: string) {
  if (!(element instanceof HTMLInputElement)) {
    throw new Error("Expected an input element");
  }

  expect(element.value).toBe(value);
}

function renderDialog({
  entryData,
  rows = datasetRows,
}: {
  entryData?: Partial<Entry>;
  rows?: DatasetRecordEntry[];
} = {}) {
  _useWorkflowStore.getState().setNodes([makeEntryNode(entryData), targetNode]);
  _useWorkflowStore.getState().setEdges([]);

  const result = render(
    <ChakraProvider value={defaultSystem}>
      <WorkflowRunUntilHereDialog
        datasetRows={rows}
        datasetColumns={rows.length > 0 ? datasetColumns : []}
        onStartWorkflowExecution={startWorkflowExecution}
        renderDatasetPreview={(props) => <DatasetPreview {...props} />}
      />
    </ChakraProvider>,
  );

  act(() => {
    useRunUntilHereDialogStore.getState().open("node-7");
  });

  return result;
}

describe("WorkflowRunUntilHereDialog", () => {
  beforeEach(() => {
    _useWorkflowStore.getState().reset();
    useRunUntilHereDialogStore.getState().close();
    startWorkflowExecution.mockReset();
  });

  afterEach(() => {
    act(() => {
      useRunUntilHereDialogStore.getState().close();
    });
    cleanup();
  });

  it("prefills entry inputs from the first dataset row and executes typed values", async () => {
    renderDialog();

    const questionInput = await screen.findByTestId("run-until-here-input-question");
    await waitFor(() => {
      expectInputValue(questionInput, "What is up?");
    });
    expectInputValue(screen.getByTestId("run-until-here-input-context"), "ctx-1");

    fireEvent.change(questionInput, { target: { value: "edited question" } });
    fireEvent.click(screen.getByTestId("run-until-here-run"));

    expect(startWorkflowExecution).toHaveBeenCalledWith({
      untilNodeId: "node-7",
      inputs: [{ question: "edited question", context: "ctx-1" }],
    });
    expect(
      getWorkflowEntryNode(_useWorkflowStore.getState().nodes)?.data.manual_run_values,
    ).toEqual({ question: "edited question", context: "ctx-1" });
    expect(useRunUntilHereDialogStore.getState().untilNodeId).toBeUndefined();
  });

  it("prefers the last submitted values over the dataset row", async () => {
    renderDialog({
      entryData: { manual_run_values: { question: "manual Q", context: "manual C" } },
    });

    expectInputValue(await screen.findByTestId("run-until-here-input-question"), "manual Q");
    expectInputValue(screen.getByTestId("run-until-here-input-context"), "manual C");
  });

  it("runs with a selected dataset row and returns to fields when cancelled", async () => {
    renderDialog();

    fireEvent.click(await screen.findByTestId("select-dataset-value"));
    fireEvent.click(await screen.findByText("Second question?"));
    expect(await screen.findByTestId("run-with-selected-row")).not.toBeNull();

    fireEvent.click(screen.getByText("Cancel"));
    expect(await screen.findByTestId("run-until-here-input-question")).not.toBeNull();

    fireEvent.click(screen.getByTestId("select-dataset-value"));
    fireEvent.click(await screen.findByText("Second question?"));
    fireEvent.click(await screen.findByTestId("run-with-selected-row"));

    expect(startWorkflowExecution).toHaveBeenCalledWith({
      untilNodeId: "node-7",
      inputs: [{ question: "Second question?", context: "ctx-2" }],
    });
  });

  it("does not loop when a caller supplies a fresh but equal row array", async () => {
    expect(() => {
      renderDialog({
        rows: [{ id: "r1", question: "What is LangWatch?", context: "ctx" }],
      });
    }).not.toThrow();

    expect(await screen.findByDisplayValue("What is LangWatch?")).not.toBeNull();
  });
});
