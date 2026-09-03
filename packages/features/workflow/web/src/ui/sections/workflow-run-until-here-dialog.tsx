import { Button, Field, HStack, Input, Spacer, Text, VStack } from "@chakra-ui/react";
import type { Node } from "@xyflow/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { Dialog } from "@langwatch/design-system/dialog";
import type { DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import type { Component, Entry } from "@langwatch/workflow-contract";

import { useRunUntilHereDialogStore } from "../../behavior/use-run-until-here-dialog-store";
import { useWorkflowStore } from "../../behavior/use-workflow-store";
import { getNodeDisplayName } from "./workflow-nodes";

export type WorkflowPartialExecutionInput = {
  untilNodeId: string;
  inputs?: Record<string, string>[];
};

export type WorkflowDatasetPreviewRow = {
  id?: string;
  isSelected?: boolean;
} & Record<string, unknown>;

export type WorkflowDatasetPreviewProps = {
  rows: WorkflowDatasetPreviewRow[];
  columns: DatasetColumns;
  onRowClick: (rowIndex: number) => void;
};

export type WorkflowRunUntilHereDialogProps = {
  datasetRows: DatasetRecordEntry[];
  datasetColumns: DatasetColumns;
  onStartWorkflowExecution: (input: WorkflowPartialExecutionInput) => void;
  renderDatasetPreview: (props: WorkflowDatasetPreviewProps) => ReactNode;
};

type EntryWorkflowNode = Node<Entry> & { type: "entry" };

const isEntryWorkflowNode = (node: Node<Component>): node is EntryWorkflowNode =>
  node.type === "entry";

export const getWorkflowEntryNode = (nodes: Node<Component>[]): EntryWorkflowNode | undefined =>
  nodes.find(isEntryWorkflowNode);

const stringifyValue = (value: unknown): string => {
  if (value === null || value === void 0) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

const hasSameValues = (
  currentValues: Record<string, string>,
  nextValues: Record<string, string>,
) => {
  const currentKeys = Object.keys(currentValues);
  const nextKeys = Object.keys(nextValues);

  return (
    currentKeys.length === nextKeys.length &&
    currentKeys.every((key) => currentValues[key] === nextValues[key])
  );
};

export function WorkflowRunUntilHereDialog({
  datasetRows,
  datasetColumns,
  onStartWorkflowExecution,
  renderDatasetPreview,
}: WorkflowRunUntilHereDialogProps) {
  const { untilNodeId, close } = useRunUntilHereDialogStore(
    useShallow(({ untilNodeId, close }) => ({ untilNodeId, close })),
  );
  const { nodes, setNode, deselectAllNodes, setPropertiesExpanded } = useWorkflowStore(
    useShallow(({ nodes, setNode, deselectAllNodes, setPropertiesExpanded }) => ({
      nodes,
      setNode,
      deselectAllNodes,
      setPropertiesExpanded,
    })),
  );

  const entryNode = getWorkflowEntryNode(nodes);
  const targetNode = nodes.find((node) => node.id === untilNodeId);
  const fields = entryNode?.data.outputs ?? [];
  const dataset = entryNode?.data.dataset;

  const [view, setView] = useState<"fields" | "table">("fields");
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | undefined>(void 0);
  const userEditedValues = useRef(false);
  useEffect(() => {
    if (!untilNodeId) {
      setView("fields");
      setSelectedRowIndex(void 0);
      userEditedValues.current = false;
      return;
    }
    if (userEditedValues.current) return;

    const manualValues = entryNode?.data.manual_run_values;
    const firstRow = datasetRows[0];
    const nextValues = Object.fromEntries(
      fields.map((field) => {
        const fromRow = firstRow?.[field.identifier];
        const value =
          manualValues?.[field.identifier] ??
          (fromRow !== void 0 && fromRow !== null
            ? stringifyValue(fromRow)
            : stringifyValue(field.value));
        return [field.identifier, value];
      }),
    );

    setValues((currentValues) =>
      hasSameValues(currentValues, nextValues) ? currentValues : nextValues,
    );
  }, [datasetRows, entryNode?.data.manual_run_values, fields, untilNodeId]);

  useEffect(() => {
    if (untilNodeId) {
      deselectAllNodes();
      setPropertiesExpanded(false);
    }
  }, [untilNodeId, deselectAllNodes, setPropertiesExpanded]);

  const runWithValues = (runValues: Record<string, string>) => {
    if (!untilNodeId) return;

    if (entryNode && fields.length > 0) {
      setNode({
        id: entryNode.id,
        data: { ...entryNode.data, manual_run_values: runValues },
      });
    }

    close();
    onStartWorkflowExecution({
      untilNodeId,
      inputs: fields.length > 0 ? [runValues] : void 0,
    });
  };

  const runWithSelectedRow = () => {
    if (selectedRowIndex === void 0) return;

    const row = datasetRows[selectedRowIndex];
    if (!row) return;

    runWithValues(
      Object.fromEntries(
        fields.map((field) => [field.identifier, stringifyValue(row[field.identifier])]),
      ),
    );
  };

  const previewRows = datasetRows.map((row, index) => ({
    ...row,
    id: stringifyValue(row.id),
    isSelected: index === selectedRowIndex,
  }));

  return (
    <Dialog.Root
      open={!!untilNodeId}
      onOpenChange={({ open }) => {
        if (!open) close();
      }}
      size={view === "table" ? "xl" : "md"}
    >
      <Dialog.Content data-testid="run-until-here-dialog">
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <VStack align="start" gap={1}>
            <Dialog.Title>Run until here</Dialog.Title>
            <Text fontSize="13px" color="fg.muted">
              {view === "table"
                ? "Pick the dataset row to run with."
                : targetNode
                  ? `Runs "${getNodeDisplayName(targetNode)}" and everything it depends on with these values.`
                  : "Runs the selected node and everything it depends on with these values."}
            </Text>
          </VStack>
        </Dialog.Header>
        <Dialog.Body>
          {view === "table" ? (
            renderDatasetPreview({
              rows: previewRows,
              columns: datasetColumns,
              onRowClick: setSelectedRowIndex,
            })
          ) : fields.length > 0 ? (
            <VStack width="full" align="start" gap={3}>
              {fields.map((field) => (
                <Field.Root key={field.identifier} width="full">
                  <Field.Label fontSize="12px" fontFamily="mono" color="fg.muted">
                    {field.identifier}
                  </Field.Label>
                  <Input
                    size="sm"
                    data-testid={`run-until-here-input-${field.identifier}`}
                    value={values[field.identifier] ?? ""}
                    onChange={(event) => {
                      userEditedValues.current = true;
                      setValues((current) => ({
                        ...current,
                        [field.identifier]: event.target.value,
                      }));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        runWithValues(values);
                      }
                    }}
                  />
                </Field.Root>
              ))}
            </VStack>
          ) : (
            <Text fontSize="13px" color="fg.muted">
              The entry point has no inputs, the run starts with an empty entry.
            </Text>
          )}
        </Dialog.Body>
        <Dialog.Footer>
          {view === "table" ? (
            <HStack width="full">
              <Spacer />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setView("fields");
                  setSelectedRowIndex(void 0);
                }}
              >
                Cancel
              </Button>
              {selectedRowIndex !== void 0 && (
                <Button
                  colorPalette="orange"
                  size="sm"
                  data-testid="run-with-selected-row"
                  onClick={runWithSelectedRow}
                >
                  Run with selected row
                </Button>
              )}
            </HStack>
          ) : (
            <HStack width="full">
              {dataset && datasetRows.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="select-dataset-value"
                  onClick={() => setView("table")}
                >
                  Select dataset value
                </Button>
              )}
              <Spacer />
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button
                colorPalette="orange"
                size="sm"
                data-testid="run-until-here-run"
                onClick={() => runWithValues(values)}
              >
                Run
              </Button>
            </HStack>
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
