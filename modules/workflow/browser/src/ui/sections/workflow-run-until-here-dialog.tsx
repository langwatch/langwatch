import { Button, Field, HStack, Input, Spacer, Text, VStack } from "@chakra-ui/react";
import type { DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { Dialog } from "@langwatch/design-system/dialog";
import type { Component, Entry } from "@langwatch/workflow-contract";
import type { Node } from "@xyflow/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useRunUntilHereDialogStore } from "../../behavior/use-run-until-here-dialog-store.ts";
import { useWorkflowStore } from "../../behavior/use-workflow-store.ts";
import { getNodeDisplayName } from "./workflow-nodes.tsx";

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

const keepIfSame = (currentValues: Record<string, string>, nextValues: Record<string, string>) =>
  hasSameValues(currentValues, nextValues) ? currentValues : nextValues;

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

function dialogDescription({
  view,
  targetNode,
}: {
  view: "fields" | "table";
  targetNode: Node<Component> | undefined;
}): string {
  if (view === "table") return "Pick the dataset row to run with.";

  if (targetNode) {
    return `Runs "${getNodeDisplayName(targetNode)}" and everything it depends on with these values.`;
  }

  return "Runs the selected node and everything it depends on with these values.";
}

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
  const fields = useMemo(() => entryNode?.data.outputs ?? [], [entryNode?.data.outputs]);
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

    const nextValues = initialRunValues({
      fields,
      manualValues: entryNode?.data.manual_run_values,
      firstRow: datasetRows[0],
    });

    setValues((currentValues) => keepIfSame(currentValues, nextValues));
  }, [datasetRows, entryNode?.data.manual_run_values, fields, untilNodeId]);

  useEffect(() => {
    if (!untilNodeId) return;
    deselectAllNodes();
    setPropertiesExpanded(false);
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
    const row = selectedRowIndex === void 0 ? undefined : datasetRows[selectedRowIndex];
    if (row) runWithValues(rowRunValues(fields, row));
  };

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
              {dialogDescription({ view, targetNode })}
            </Text>
          </VStack>
        </Dialog.Header>
        <Dialog.Body>
          {view === "table" ? (
            renderDatasetPreview({
              rows: previewRowsOf(datasetRows, selectedRowIndex),
              columns: datasetColumns,
              onRowClick: setSelectedRowIndex,
            })
          ) : (
            <RunUntilHereFields
              fields={fields}
              values={values}
              onEdit={(identifier, value) => {
                userEditedValues.current = true;
                setValues((current) => ({ ...current, [identifier]: value }));
              }}
              onSubmit={() => runWithValues(values)}
            />
          )}
        </Dialog.Body>
        <Dialog.Footer>
          {view === "table" ? (
            <TableViewFooter
              hasSelection={selectedRowIndex !== void 0}
              onCancel={() => {
                setView("fields");
                setSelectedRowIndex(void 0);
              }}
              onRunWithSelectedRow={runWithSelectedRow}
            />
          ) : (
            <FieldsViewFooter
              canPickDatasetValue={!!dataset && datasetRows.length > 0}
              onPickDatasetValue={() => setView("table")}
              onCancel={close}
              onRun={() => runWithValues(values)}
            />
          )}
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}

type EntryField = NonNullable<Entry["outputs"]>[number];

function initialRunValues({
  fields,
  manualValues,
  firstRow,
}: {
  fields: EntryField[];
  manualValues: Entry["manual_run_values"];
  firstRow: DatasetRecordEntry | undefined;
}): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => {
      const fromRow = firstRow?.[field.identifier];
      const fallback = fromRow ?? field.value;
      return [field.identifier, manualValues?.[field.identifier] ?? stringifyValue(fallback)];
    }),
  );
}

function RunUntilHereFields({
  fields,
  values,
  onEdit,
  onSubmit,
}: {
  fields: EntryField[];
  values: Record<string, string>;
  onEdit: (identifier: string, value: string) => void;
  onSubmit: () => void;
}) {
  if (fields.length === 0) {
    return (
      <Text fontSize="13px" color="fg.muted">
        The entry point has no inputs, the run starts with an empty entry.
      </Text>
    );
  }
  return (
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
            onChange={(event) => onEdit(field.identifier, event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              onSubmit();
            }}
          />
        </Field.Root>
      ))}
    </VStack>
  );
}

function TableViewFooter({
  hasSelection,
  onCancel,
  onRunWithSelectedRow,
}: {
  hasSelection: boolean;
  onCancel: () => void;
  onRunWithSelectedRow: () => void;
}) {
  return (
    <HStack width="full">
      <Spacer />
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      {hasSelection && (
        <Button
          colorPalette="orange"
          size="sm"
          data-testid="run-with-selected-row"
          onClick={onRunWithSelectedRow}
        >
          Run with selected row
        </Button>
      )}
    </HStack>
  );
}

function FieldsViewFooter({
  canPickDatasetValue,
  onPickDatasetValue,
  onCancel,
  onRun,
}: {
  canPickDatasetValue: boolean;
  onPickDatasetValue: () => void;
  onCancel: () => void;
  onRun: () => void;
}) {
  return (
    <HStack width="full">
      {canPickDatasetValue && (
        <Button
          variant="outline"
          size="sm"
          data-testid="select-dataset-value"
          onClick={onPickDatasetValue}
        >
          Select dataset value
        </Button>
      )}
      <Spacer />
      <Button variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
      <Button colorPalette="orange" size="sm" data-testid="run-until-here-run" onClick={onRun}>
        Run
      </Button>
    </HStack>
  );
}

function rowRunValues(fields: EntryField[], row: DatasetRecordEntry): Record<string, string> {
  return Object.fromEntries(
    fields.map((field) => [field.identifier, stringifyValue(row[field.identifier])]),
  );
}

function previewRowsOf(
  datasetRows: DatasetRecordEntry[],
  selectedRowIndex: number | undefined,
): WorkflowDatasetPreviewRow[] {
  return datasetRows.map((row, index) => ({
    ...row,
    id: stringifyValue(row.id),
    isSelected: index === selectedRowIndex,
  }));
}
