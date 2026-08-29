/**
 * The targets of a comparison, one row each: a colour dot, the agent, its
 * parameter line, and an x.
 *
 * The section stands in for the agent section and the parameter section
 * while the run is a comparison. Its colours are by row position, the same
 * colours the run detail gives the targets.
 *
 * @see specs/features/agent-testing/comparison-mode.feature
 */

import {
  Box,
  chakra,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Plus, X } from "lucide-react";
import { agentHasDevTunnel } from "~/components/agents/LocalTunnelBadge";
import { DIALOG_FIELD_STYLE, FieldLabel } from "../shared/DialogFields";
import { FG_MUTED, QUIET_BUTTON_SHADOW } from "../shared/design";
import { RemoveBlockButton } from "../shared/RemoveBlockButton";
import { targetColor } from "../shared/target-colors";
import { type CompareRow, DUPLICATE_TARGETS_MESSAGE } from "./compare-rows";
import type { RunDialogAgent } from "./RunTargetPicker";

export const COMPARE_PARAMETERS_PLACEHOLDER = "model=gpt-5-mini";

export const COMPARE_HINT =
  "The same agent twice with different parameters works: one connection, two models.";

/** What an agent reads as in the list, with its tunnel mark. */
function agentOptionLabel(agent: RunDialogAgent): string {
  return agentHasDevTunnel(agent) ? `${agent.name} · Local tunnel` : agent.name;
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
  isBusy,
}: {
  rows: CompareRow[];
  agents: RunDialogAgent[];
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
          agents={agents}
          onChangeRow={onChangeRow}
          onRemoveRow={onRemoveRow}
          isBusy={isBusy}
        />
      ))}
      {hasDuplicates && (
        <Text
          fontSize="11px"
          color="red.fg"
          data-testid="run-dialog-compare-error"
        >
          {DUPLICATE_TARGETS_MESSAGE}
        </Text>
      )}
      {canAddRow && (
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
      )}
      <Text
        fontSize="11px"
        color={FG_MUTED}
        data-testid="run-dialog-compare-hint"
      >
        {COMPARE_HINT}
      </Text>
    </VStack>
  );
}

/** One target: its colour, its agent, its parameter line, and the x. */
function CompareTargetRow({
  row,
  index,
  agents,
  onChangeRow,
  onRemoveRow,
  isBusy,
}: {
  row: CompareRow;
  index: number;
  agents: RunDialogAgent[];
  onChangeRow: (index: number, patch: Partial<CompareRow>) => void;
  onRemoveRow: (index: number) => void;
  isBusy: boolean;
}) {
  const position = index + 1;

  return (
    <HStack
      gap={2}
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
        background={targetColor(index)}
        data-testid={`run-dialog-compare-dot-${index}`}
        data-color={targetColor(index)}
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
      <Input
        {...DIALOG_FIELD_STYLE}
        flex={1}
        minWidth={0}
        fontFamily="mono"
        fontSize="12px"
        aria-label={`Parameters of target ${position}`}
        placeholder={COMPARE_PARAMETERS_PLACEHOLDER}
        value={row.parameterLine}
        disabled={isBusy}
        onChange={(event) =>
          onChangeRow(index, { parameterLine: event.target.value })
        }
        data-testid={`run-dialog-compare-parameters-${index}`}
      />
      <chakra.button
        type="button"
        display="flex"
        alignItems="center"
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
