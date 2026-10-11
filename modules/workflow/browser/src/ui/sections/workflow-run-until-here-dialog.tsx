import type { DatasetColumns, DatasetRecordEntry } from "@langwatch/dataset-contract";
import { Dialog, type FrameAction } from "@langwatch/design-system/dialog";
import { Field, Input, Text, VStack } from "@langwatch/design-system/primitives";
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

  const backToFields = () => {
    setView("fields");
    setSelectedRowIndex(void 0);
  };
  const canPickDatasetValue = !!dataset && datasetRows.length > 0;
  const inTable = view === "table";
  const rowAction: FrameAction | undefined =
    selectedRowIndex === void 0
      ? undefined
      : {
          label: "Run with selected row",
          onClick: runWithSelectedRow,
          "data-testid": "run-with-selected-row",
        };
  const selectDatasetAction: FrameAction[] = canPickDatasetValue
    ? [
        {
          label: "Select dataset value",
          onClick: () => setView("table"),
          "data-testid": "select-dataset-value",
        },
      ]
    : [];

  return (
    <Dialog
      open={!!untilNodeId}
      onClose={close}
      title="Run until here"
      description={dialogDescription({ view, targetNode })}
      size={inTable ? "md" : "sm"}
      data-testid="run-until-here-dialog"
      secondaryAction={inTable ? { label: "Cancel", onClick: backToFields } : void 0}
      secondaryActions={inTable ? void 0 : selectDatasetAction}
      primaryAction={
        inTable
          ? rowAction
          : {
              label: "Run",
              onClick: () => runWithValues(values),
              "data-testid": "run-until-here-run",
            }
      }
    >
      {inTable ? (
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
    </Dialog>
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
      <Text textStyle="bodySm" color="fg.muted">
        The entry point has no inputs, the run starts with an empty entry.
      </Text>
    );
  }
  return (
    <VStack width="full" align="start" gap={3}>
      {fields.map((field) => (
        <Field.Root key={field.identifier} width="full">
          <Field.Label textStyle="monoSm" color="fg.muted">
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
