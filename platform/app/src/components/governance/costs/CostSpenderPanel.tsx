import { Badge, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { getHexColorForString } from "~/utils/rotatingColors";
import { fmtMoney } from "./CostCharts";

/**
 * The billed-spend-by-person list (ADR-128 §14 / ADR-129).
 *
 * This panel reads the PULLED lane's spender breakdown — what the provider's
 * own bill attributed to each person — which is different money from the
 * "Cost by user" panel beside it (the gateway's metering of traffic it
 * served). The two disagree on purpose and are never reconciled here; each is
 * labeled for its lane, same discipline as the totals.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   Rule: Pulled spend says who spent it, in the words the identity screen uses
 */

/** One row of the tRPC spender DTO, as the panel receives it. */
export interface SpenderRow {
  provider: string;
  rawActorId: string;
  /** Null only on the not-named bucket row. */
  label: string | null;
  agentId: string;
  amountUsd: number | null;
  cellsWithoutAmount: number;
}

/** The copy for the bucket row — the screen's words, never a DTO invention. */
export const NOT_NAMED_LABEL = "No one named";

export interface SpenderDisplayRow {
  key: string;
  label: string;
  /** True on the bucket row, so it is styled as a remainder, not a person. */
  notNamed: boolean;
  /** Empty when the provider named no agent. */
  agentId: string;
  /** Null when the figure is withheld — never 0 as a stand-in. */
  amountUsd: number | null;
  cellsWithoutAmount: number;
  /** Bar length, scaled against the largest priced row. 0 when withheld. */
  widthPct: number;
}

/**
 * DTO rows to what the panel draws. Order is preserved — the service already
 * ranks by figure with the bucket last, and re-sorting here would put the
 * bucket wherever its size lands it, dressed up as the biggest spender.
 */
export function spenderDisplayRows(rows: SpenderRow[]): SpenderDisplayRow[] {
  const scale = rows.reduce(
    (max, row) => Math.max(max, Math.abs(row.amountUsd ?? 0)),
    0,
  );
  return rows.map((row) => ({
    key: `${row.provider}\u0000${row.rawActorId}\u0000${row.agentId}`,
    label: row.label ?? NOT_NAMED_LABEL,
    notNamed: row.label === null,
    agentId: row.agentId,
    amountUsd: row.amountUsd,
    cellsWithoutAmount: row.cellsWithoutAmount,
    widthPct:
      row.amountUsd === null || scale === 0
        ? 0
        : (Math.abs(row.amountUsd) / scale) * 100,
  }));
}

function SpenderName({ row }: { row: SpenderDisplayRow }) {
  return (
    <HStack flex="0 0 40%" gap={2} minWidth={0}>
      <Text
        truncate
        title={row.notNamed ? undefined : row.label}
        color={row.notNamed ? "fg.muted" : undefined}
      >
        {row.label}
      </Text>
      {row.agentId !== "" && (
        <Badge size="xs" variant="subtle" colorPalette="gray" title="agent">
          {row.agentId}
        </Badge>
      )}
    </HStack>
  );
}

function SpenderBar({ row }: { row: SpenderDisplayRow }) {
  return (
    <Box
      flex="1"
      height="14px"
      borderRadius="sm"
      backgroundColor="bg.muted"
      overflow="hidden"
    >
      <Box
        height="100%"
        borderRadius="sm"
        width={`${row.widthPct}%`}
        data-width-pct={row.widthPct}
        backgroundColor={
          row.notNamed ? "border.emphasized" : getHexColorForString(row.label)
        }
      />
    </Box>
  );
}

function SpenderFigure({ row }: { row: SpenderDisplayRow }) {
  return (
    <Text
      flex="0 0 18%"
      textAlign="right"
      fontVariantNumeric="tabular-nums"
      title={
        row.amountUsd === null
          ? `${row.cellsWithoutAmount} of this spender's rows hold no US-dollar figure, so no total is shown`
          : undefined
      }
      color={row.amountUsd === null ? "fg.muted" : undefined}
    >
      {row.amountUsd === null ? "—" : fmtMoney(row.amountUsd)}
    </Text>
  );
}

export function CostSpenderList({ rows }: { rows: SpenderRow[] }) {
  const shown = spenderDisplayRows(rows);
  return (
    <VStack align="stretch" gap={2}>
      {shown.map((row) => (
        <HStack key={row.key} gap={3} fontSize="sm">
          <SpenderName row={row} />
          <SpenderBar row={row} />
          <SpenderFigure row={row} />
        </HStack>
      ))}
    </VStack>
  );
}
