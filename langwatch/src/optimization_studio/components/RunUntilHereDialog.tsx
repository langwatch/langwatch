import {
  Button,
  Field,
  HStack,
  Input,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { DatasetPreviewTable } from "../../components/datasets/editor/DatasetPreviewTable";
import { Dialog } from "../../components/ui/dialog";
import { useGetDatasetData } from "../hooks/useGetDatasetData";
import { useRunUntilHereDialogStore } from "../hooks/useRunUntilHereDialogStore";
import { useWorkflowExecution } from "../hooks/useWorkflowExecution";
import { useWorkflowStore } from "../hooks/useWorkflowStore";
import type { Entry } from "../types/dsl";
import { getNodeDisplayName } from "./nodes/Nodes";

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
};

/**
 * Asks which values a partial run should execute with, instead of the
 * old hidden "Manual Test Entry" first/last/random picker on the entry
 * drawer. Fields prefill from the last submitted values (persisted on
 * the entry node as `manual_run_values`) or the first dataset row, and
 * an attached dataset can be browsed to run with one of its rows.
 * UX contract: specs/workflows/run-until-here-dialog.feature.
 */
export function RunUntilHereDialog() {
  const { untilNodeId, close } = useRunUntilHereDialogStore(
    useShallow(({ untilNodeId, close }) => ({ untilNodeId, close })),
  );
  const { nodes, setNode, deselectAllNodes, setPropertiesExpanded } =
    useWorkflowStore(
      useShallow(
        ({ nodes, setNode, deselectAllNodes, setPropertiesExpanded }) => ({
          nodes,
          setNode,
          deselectAllNodes,
          setPropertiesExpanded,
        }),
      ),
    );
  const { startWorkflowExecution } = useWorkflowExecution();

  const entryNode = nodes.find((node) => node.type === "entry");
  const entryData = entryNode?.data as Entry | undefined;
  const targetNode = nodes.find((node) => node.id === untilNodeId);
  const fields = entryData?.outputs ?? [];
  const dataset = entryData?.dataset;

  const { rows, columns } = useGetDatasetData({ dataset });

  const [view, setView] = useState<"fields" | "table">("fields");
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | undefined>(
    undefined,
  );
  const userEditedValues = useRef(false);

  // useGetDatasetData returns a fresh `rows` array reference on every render
  // for saved datasets, so depending on `rows` directly re-fires this effect
  // each render and the setValues below (always a new object) never settles -
  // an infinite render loop. Key the prefill on the first row's CONTENT
  // instead, which is stable across renders once the data has loaded.
  const firstRowSignature = JSON.stringify(rows[0] ?? null);

  // Prefill on open: last submitted values win, then the first dataset
  // row (which may arrive async for saved datasets), then the input's
  // default value, then empty.
  useEffect(() => {
    if (!untilNodeId) {
      setView("fields");
      setSelectedRowIndex(undefined);
      userEditedValues.current = false;
      return;
    }
    if (userEditedValues.current) return;
    const manualValues = (entryNode?.data as Entry | undefined)
      ?.manual_run_values;
    const firstRow = rows[0];
    setValues(
      Object.fromEntries(
        (entryData?.outputs ?? []).map((field) => {
          const fromRow = firstRow?.[field.identifier];
          const value =
            manualValues?.[field.identifier] ??
            (fromRow !== undefined && fromRow !== null
              ? stringifyValue(fromRow)
              : stringifyValue(field.value));
          return [field.identifier, value];
        }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [untilNodeId, firstRowSignature]);

  // Opening the dialog from a node's run menu selects that node, which
  // surfaces its properties drawer docked behind the dialog. Deselect so the
  // dialog stays clean; the drawer reopens on its own when the run completes
  // (usePostEvent's execution_state_change handler re-selects the target).
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
        data: { ...entryNode.data, manual_run_values: runValues } as Entry,
      });
    }
    close();
    startWorkflowExecution({
      untilNodeId,
      inputs: fields.length > 0 ? [runValues] : undefined,
    });
  };

  const runWithSelectedRow = () => {
    if (selectedRowIndex === undefined) return;
    const row = rows[selectedRowIndex];
    if (!row) return;
    runWithValues(
      Object.fromEntries(
        fields.map((field) => [
          field.identifier,
          stringifyValue(row[field.identifier]),
        ]),
      ),
    );
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
            <DatasetPreviewTable
              rows={rows.map((row, index) => ({
                ...row,
                id: stringifyValue(row.id),
                isSelected: index === selectedRowIndex,
              }))}
              columns={columns}
              background="bg.panel"
              onRowClick={(rowIndex) => setSelectedRowIndex(rowIndex)}
            />
          ) : fields.length > 0 ? (
            <VStack width="full" align="start" gap={3}>
              {fields.map((field) => (
                <Field.Root key={field.identifier} width="full">
                  <Field.Label
                    fontSize="12px"
                    fontFamily="mono"
                    color="fg.muted"
                  >
                    {field.identifier}
                  </Field.Label>
                  <Input
                    size="sm"
                    data-testid={`run-until-here-input-${field.identifier}`}
                    value={values[field.identifier] ?? ""}
                    onChange={(e) => {
                      userEditedValues.current = true;
                      setValues((current) => ({
                        ...current,
                        [field.identifier]: e.target.value,
                      }));
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
                  setSelectedRowIndex(undefined);
                }}
              >
                Cancel
              </Button>
              {selectedRowIndex !== undefined && (
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
              {dataset && rows.length > 0 && (
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
