/**
 * The targets of a comparison, one row each: a colour dot, the agent, its
 * parameter line, and an x.
 *
 * The section stands in for the agent section and the parameter section
 * while the run is a comparison. A row takes the colour of its place in the
 * sorted target list, which is the order the run detail colours its columns
 * by, so one target reads in one colour on both surfaces.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import { Box, chakra, HStack, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { agentHasDevTunnel } from "@langwatch/agent-web/surfaces/browser-port";
import type { DeclaredParameter } from "../../../../behavior/suites/use-run-suite";
import {
  DIALOG_FIELD_STYLE,
  FieldLabel,
} from "../../../elements/agent-testing/shared/dialog-fields";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../../../../model/agent-testing/shared/design";
import { RemoveBlockButton } from "../../../elements/agent-testing/shared/remove-block-button";
import { targetColor } from "../../../elements/agent-testing/shared/target-colors";
import {
  type CompareRow,
  compareRowColorIndexes,
  DUPLICATE_TARGETS_MESSAGE,
  type ParameterDefaults,
} from "./compare-rows";
import { ParameterLineField } from "./parameter-line-field";
import {
  errorOnLine,
  type ParameterFieldError,
  parameterPlaceholder,
} from "./parameter-suggestions";
import type { RunDialogAgent } from "./run-target-picker";

export const COMPARE_HINT =
  "The same agent twice with different parameters works: one connection, two models.";

/** What an agent reads as in the list, with its tunnel mark. */
function agentOptionLabel(agent: RunDialogAgent): string {
  const name = agent.label ?? agent.name;
  return agentHasDevTunnel(agent) ? `${name} · Local tunnel` : name;
}

function AddTargetButton({ onAddRow, isBusy }: { onAddRow: () => void; isBusy: boolean }) {
  return (
    <chakra.button
      type="button"
      alignSelf="flex-start"
      display="flex"
      alignItems="center"
      gap={1}
      marginTop={0.5}
      fontSize="11.5px"
      fontWeight="medium"
      color={FG_MUTED}
      cursor="pointer"
      boxShadow={QUIET_BUTTON_SHADOW}
      _hover={{ color: "fg" }}
      disabled={isBusy}
      onClick={onAddRow}
      data-testid="run-dialog-compare-add"
    >
      <Plus size={12} />
      Add a target to compare
    </chakra.button>
  );
}

function DuplicateTargetsError() {
  return (
    <Text fontSize="11px" color="red.fg" data-testid="run-dialog-compare-error">
      {DUPLICATE_TARGETS_MESSAGE}
    </Text>
  );
}

function CompareHint() {
  return (
    <Text fontSize="11px" color={FG_MUTED} data-testid="run-dialog-compare-hint">
      {COMPARE_HINT}
    </Text>
  );
}

export function CompareAgentsSection({
  rows,
  agents,
  onChangeRow,
  onAddRow,
  canAddRow,
  onRemoveRow,
  onRemove,
  hasDuplicates,
  defaults,
  definitions,
  declaredParametersOf,
  parameterError = null,
  isBusy,
}: {
  rows: CompareRow[];
  agents: RunDialogAgent[];
  /** The declared defaults, which a typed value equal to does not override. */
  defaults: ParameterDefaults;
  /** The declarations in scope across every row. */
  definitions: readonly DeclaredParameter[];
  /** The declarations in scope for one agent, which its row offers. */
  declaredParametersOf: (agentId: string) => DeclaredParameter[];
  /** A refusal the server addressed to one parameter, read under its row. */
  parameterError?: ParameterFieldError | null;
  onChangeRow: (index: number, patch: Partial<CompareRow>) => void;
  onAddRow: () => void;
  /** False once the section holds as many rows as a run compares. */
  canAddRow: boolean;
  onRemoveRow: (index: number) => void;
  onRemove: () => void;
  /** Whether two rows name the same agent with the same parameters. */
  hasDuplicates: boolean;
  isBusy: boolean;
}) {
  const colorIndexes = compareRowColorIndexes({ rows, defaults, definitions });

  return (
    <VStack align="stretch" gap={1.5} data-testid="run-dialog-compare">
      <FieldLabel>
        Compare agents
        <RemoveBlockButton label="Remove the comparison" onClick={onRemove} />
      </FieldLabel>
      {rows.map((row, index) => (
        <CompareTargetRow
          // Rows are addressed by position: the same agent may sit in two
          // rows, so nothing on a row identifies it.
          key={index}
          row={row}
          index={index}
          colorIndex={colorIndexes[index] ?? index}
          agents={agents}
          definitions={declaredParametersOf(row.target.id)}
          error={errorOnLine({
            line: row.parameterLine,
            error: parameterError,
          })}
          onChangeRow={onChangeRow}
          onRemoveRow={onRemoveRow}
          isBusy={isBusy}
        />
      ))}
      {hasDuplicates && <DuplicateTargetsError />}
      {canAddRow && <AddTargetButton onAddRow={onAddRow} isBusy={isBusy} />}
      <CompareHint />
    </VStack>
  );
}

/** One target: its colour, its agent, its parameter line, and the x. */
function CompareTargetRow({
  row,
  index,
  colorIndex,
  agents,
  definitions,
  error,
  onChangeRow,
  onRemoveRow,
  isBusy,
}: {
  row: CompareRow;
  index: number;
  /** The place of the row in the sorted target list, which is its colour. */
  colorIndex: number;
  agents: RunDialogAgent[];
  /** The parameters this row's agent and the scenarios declare. */
  definitions: readonly DeclaredParameter[];
  /** What the server refused about this row's line, read under it. */
  error: string | undefined;
  onChangeRow: (index: number, patch: Partial<CompareRow>) => void;
  onRemoveRow: (index: number) => void;
  isBusy: boolean;
}) {
  const position = index + 1;

  return (
    <HStack
      gap={2}
      alignItems="flex-start"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      paddingX={3}
      paddingY={2}
      data-testid={`run-dialog-compare-row-${index}`}
    >
      <Box
        boxSize="8px"
        borderRadius="full"
        flexShrink={0}
        marginTop="7px"
        background={targetColor(colorIndex)}
        data-testid={`run-dialog-compare-dot-${index}`}
        data-color={targetColor(colorIndex)}
      />
      <NativeSelect.Root size="sm" flex="0 0 180px" disabled={isBusy}>
        <NativeSelect.Field
          {...DIALOG_FIELD_STYLE}
          fontSize="12px"
          aria-label={`Agent of target ${position}`}
          value={row.target.id}
          onChange={(event) => {
            const agent = agents.find((a) => a.id === event.target.value);
            if (agent) {
              onChangeRow(index, {
                target: { type: agent.type, id: agent.id },
              });
            }
          }}
          data-testid={`run-dialog-compare-agent-${index}`}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agentOptionLabel(agent)}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <ParameterLineField
        flex={1}
        minWidth={0}
        ariaLabel={`Parameters of target ${position}`}
        placeholder={parameterPlaceholder(definitions)}
        value={row.parameterLine}
        onChange={(parameterLine) => onChangeRow(index, { parameterLine })}
        definitions={definitions}
        error={error}
        disabled={isBusy}
        testId={`run-dialog-compare-parameters-${index}`}
      />
      <chakra.button
        type="button"
        display="flex"
        alignItems="center"
        marginTop="6px"
        color={FG_MUTED}
        cursor="pointer"
        boxShadow={QUIET_BUTTON_SHADOW}
        _hover={{ color: "red.fg" }}
        title="Remove"
        aria-label={`Remove target ${position}`}
        disabled={isBusy}
        onClick={() => onRemoveRow(index)}
        data-testid={`run-dialog-compare-remove-${index}`}
      >
        <X size={13} />
      </chakra.button>
    </HStack>
  );
}
