import {
  Alert,
  Badge,
  Box,
  Button,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { getHexColorForString } from "~/utils/rotatingColors";
import { fmtMoney } from "./CostCharts";

/**
 * Provider-reported cost grouped by the provider's user id (ADR-129).
 * The read resolves those ids through discovered people; it does not group
 * by API key or prove who physically used a shared credential.
 *
 * Spec: specs/governance/governance-cost-screen.feature
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
export const NOT_NAMED_LABEL = "Unattributed spend";

export interface SpenderDisplayRow {
  key: string;
  label: string;
  /** True on the bucket row, so it is styled as a remainder, not a person. */
  notNamed: boolean;
  /**
   * Shown on every row, not only ambiguous ones: the same person billed at
   * two providers is two rows with one label, and without the provider on
   * screen that reads as an accidental duplicate.
   */
  provider: string;
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
    provider: row.provider,
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
  // Leave room for the provider and optional agent beside the user's label.
  return (
    <HStack flex="0 0 62%" gap={2} minWidth={0}>
      <Text
        truncate
        minWidth={0}
        title={row.notNamed ? undefined : row.label}
        color={row.notNamed ? "fg.muted" : undefined}
      >
        {row.label}
      </Text>
      {/* The bucket row spans providers and carries none — no empty pill. */}
      {row.provider !== "" && (
        <Badge
          size="xs"
          variant="subtle"
          colorPalette="gray"
          title="provider"
          flexShrink={0}
        >
          {row.provider}
        </Badge>
      )}
      {row.agentId !== "" && (
        <Badge
          size="xs"
          variant="subtle"
          colorPalette="gray"
          title="agent"
          flexShrink={0}
        >
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
          ? `${row.cellsWithoutAmount} of this user's rows hold no US-dollar figure, so no total is shown`
          : undefined
      }
      color={row.amountUsd === null ? "fg.muted" : undefined}
    >
      {row.amountUsd === null ? "—" : fmtMoney(row.amountUsd)}
    </Text>
  );
}

/**
 * The breakdown read failed. Rendered in the panel's place rather than
 * dropping the panel: absence is this screen's word for "nobody spent
 * anything", and a failed read does not know that — same rule as the lanes'
 * own failed-read state.
 */
export function CostSpenderError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert.Root status="error" data-testid="cost-spenders-error">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          Provider-reported spend by user could not be loaded
        </Alert.Title>
        <Alert.Description>
          Something went wrong reading which users the provider named for this
          spend. The totals above are a separate read and stand on their own.
        </Alert.Description>
      </Alert.Content>
      <Button size="xs" variant="outline" onClick={onRetry} alignSelf="center">
        Try again
      </Button>
    </Alert.Root>
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
