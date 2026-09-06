import { Box, HStack, Icon, Table, Text, VStack } from "@chakra-ui/react";
import {
  LuArrowDown,
  LuArrowUp,
  LuArrowUpDown,
  LuTriangleAlert,
} from "react-icons/lu";
import type { BTLeaderboard } from "./computeBTLeaderboard";
import { winMatrixHasPairwiseDetail } from "./computeWinMatrixShape";
import {
  type RankedEntry,
  type SortDir,
  type SortKey,
  usePairwiseSort,
} from "./usePairwiseSort";

/**
 * Bradley-Terry leaderboard panel for the Comparison evaluator (#5103).
 * Purely presentational — caller computes `leaderboard` via
 * `computeBTLeaderboard` and passes it in.
 *
 * Reached only through the mount sites, which carry both gates: the
 * `release_ui_comparison_leaderboard_enabled` rollout flag
 * (useShowComparisonLeaderboard) and the 3+ variant product rule
 * (ComparisonCharts).
 */

export type PairwiseLeaderboardProps = {
  leaderboard: BTLeaderboard;
  /** variantId -> human-readable name for table + heatmap labels. */
  variantNames: Record<string, string>;
  /**
   * Sample-size threshold for the warning banner — fires when any variant has
   * fewer matchups than this. Default 30 per the issue spec; configurable to
   * allow tighter thresholds for quick checks.
   */
  warnThreshold?: number;
  /**
   * Called when a win-matrix cell is clicked, so the caller can show the
   * judge's reasoning for every row where `rowVariantId` beat `colVariantId`.
   */
  onCellClick?: (rowVariantId: string, colVariantId: string) => void;
  /**
   * Whether to render the sample-size / degenerate / convergence banners.
   * The drawer turns these off because it states the same conditions once,
   * up front, in its own trust step — repeating them here would train the
   * reader to scroll past a warning they have already read.
   */
  showWarnings?: boolean;
};

/**
 * Matchups per variant below which a Bradley-Terry score is treated as
 * unstable. Exported because the drawer gates its own trust panel on the same
 * number — two copies would let the table's warnings and the panel's verdict
 * drift apart inside one view, with nothing enforcing that they agree.
 */
export const DEFAULT_WARN_THRESHOLD = 30;

export function PairwiseLeaderboard({
  leaderboard,
  variantNames,
  warnThreshold = DEFAULT_WARN_THRESHOLD,
  onCellClick,
  showWarnings = true,
}: PairwiseLeaderboardProps) {
  const { sorted, sortKey, sortDir, onSort } = usePairwiseSort({
    entries: leaderboard.entries,
    variantNames,
  });

  return (
    <VStack
      align="stretch"
      gap={3}
      padding={3}
      borderRadius="md"
      borderWidth="1px"
      borderColor="border.muted"
      bg="bg.subtle"
    >
      <HStack gap={2} flexWrap="wrap">
        <Text fontWeight="semibold" fontSize="sm">
          Leaderboard (95% confidence)
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {/*
            Two different units, so both are named. A comparison is one judge
            verdict over the whole field; a matchup is one variant against one
            other, which that verdict yields several of. Printed as bare
            numbers, the per-variant figure routinely exceeds the total and
            the pair reads as a contradiction.
          */}
          {leaderboard.comparisonCount} comparisons · min{" "}
          {leaderboard.minMatchups} matchups per variant
        </Text>
      </HStack>

      <LeaderboardWarnings
        leaderboard={leaderboard}
        warnThreshold={warnThreshold}
        showWarnings={showWarnings}
      />

      <LeaderboardTable
        sorted={sorted}
        sortKey={sortKey}
        sortDir={sortDir}
        onSort={onSort}
      />

      <WinMatrixHeatmap
        leaderboard={leaderboard}
        variantNames={variantNames}
        onCellClick={onCellClick}
      />
    </VStack>
  );
}

/**
 * The three conditions that make a Bradley-Terry fit less trustworthy than its
 * numbers look. Kept together so the drawer can silence all of them with one
 * flag — it states the same conditions once in its own trust step, and a reader
 * shown the warning twice learns to scroll past it.
 */
function LeaderboardWarnings({
  leaderboard,
  warnThreshold,
  showWarnings,
}: {
  leaderboard: BTLeaderboard;
  warnThreshold: number;
  showWarnings: boolean;
}) {
  if (!showWarnings) return null;

  const isLowSample = leaderboard.minMatchups < warnThreshold;

  return (
    <>
      {isLowSample ? (
        <WarnBanner
          tone="warning"
          icon={LuTriangleAlert}
          text={`Sample size low — at least one variant has fewer than ${warnThreshold} matchups. Scores may be unstable.`}
        />
      ) : null}

      {leaderboard.hasDegenerate ? (
        <WarnBanner
          tone="info"
          icon={LuTriangleAlert}
          text="One or more variants have no wins or no losses — MLE is undefined for those and shown smoothed at the bottom of the table."
        />
      ) : null}

      {!leaderboard.didConverge ? (
        <WarnBanner
          tone="warning"
          icon={LuTriangleAlert}
          text="BT solver did not fully converge; scores are approximate."
        />
      ) : null}
    </>
  );
}

/** The ranked table itself. Every measure column is sortable; Variant is not. */
function LeaderboardTable({
  sorted,
  sortKey,
  sortDir,
  onSort,
}: {
  sorted: RankedEntry[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
}) {
  return (
    <Box overflowX="auto">
      <Table.Root size="sm" variant="outline">
        <Table.Header>
          <Table.Row>
            <SortableHeader
              label="Rank"
              col="rank"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <Table.ColumnHeader>Variant</Table.ColumnHeader>
            <SortableHeader
              label="Score (± 95% confidence)"
              col="score"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="Win rate"
              col="winRate"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
            <SortableHeader
              label="N"
              col="matchups"
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
            />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {sorted.map((e) => (
            <Table.Row key={e.variantId}>
              <Table.Cell>{e.rank}</Table.Cell>
              <Table.Cell>
                <HStack gap={2}>
                  <Text>{e.name}</Text>
                  {e.isDegenerate ? (
                    <Text fontSize="xs" color="fg.muted">
                      (never won / never lost)
                    </Text>
                  ) : null}
                </HStack>
              </Table.Cell>
              <Table.Cell>{formatScoreWithCI(e.score, e.scoreCI)}</Table.Cell>
              <Table.Cell>
                {e.winRate === null ? "—" : `${Math.round(e.winRate * 100)}%`}
              </Table.Cell>
              <Table.Cell>{e.matchups}</Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}

function SortableHeader({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === col;
  const ArrowIcon = !active
    ? LuArrowUpDown
    : sortDir === "asc"
      ? LuArrowUp
      : LuArrowDown;
  return (
    // `aria-sort` on the header itself, not just a keyboard handler on the
    // control inside it: the arrow icon communicates the sort state visually,
    // and this is the only thing that communicates it to a screen reader.
    // Keyboard reachability without it would let someone sort the table and
    // have no way to learn that they had.
    <Table.ColumnHeader
      aria-sort={
        active ? (sortDir === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <HStack
        gap={1}
        cursor="pointer"
        onClick={() => onSort(col)}
        userSelect="none"
        role="button"
        tabIndex={0}
        aria-label={`Sort by ${label}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            // Space scrolls the page by default; a control that responds to it
            // has to say so.
            e.preventDefault();
            onSort(col);
          }
        }}
        _focusVisible={{ outline: "2px solid", outlineColor: "blue.focusRing" }}
      >
        <Text>{label}</Text>
        <Icon
          as={ArrowIcon}
          boxSize="12px"
          color={active ? "fg" : "fg.muted"}
        />
      </HStack>
    </Table.ColumnHeader>
  );
}

function formatScoreWithCI(score: number, ci: [number, number] | null): string {
  const rounded = score.toFixed(2);
  if (!ci) return rounded;
  // A bootstrap over a handful of comparisons can return an unbounded
  // interval. Printing "46.96 ± Infinity" tells the reader nothing and
  // reads as a bug; the score alone is the honest thing to show, and the
  // trust step already explains that the sample is too small.
  if (!Number.isFinite(ci[0]) || !Number.isFinite(ci[1])) return rounded;
  // Symmetric half-width for display; close enough for power-user judgment
  // and matches the "1.42 ± 0.18" shape in the issue mockup. The raw CI is
  // still in props for anyone who wants the asymmetric range.
  const halfWidth = (ci[1] - ci[0]) / 2;
  return `${rounded} ± ${halfWidth.toFixed(2)}`;
}

function WarnBanner({
  tone,
  icon,
  text,
}: {
  tone: "warning" | "info";
  icon: React.ElementType;
  text: string;
}) {
  const bg = tone === "warning" ? "yellow.subtle" : "blue.subtle";
  const fg = tone === "warning" ? "yellow.fg" : "blue.fg";
  return (
    <HStack
      gap={2}
      paddingX={3}
      paddingY={2}
      borderRadius="md"
      bg={bg}
      color={fg}
      fontSize="xs"
    >
      <Icon as={icon} boxSize="14px" />
      <Text>{text}</Text>
    </HStack>
  );
}

/** The head-to-head record behind one cell, and how it reads aloud. */
const matchupOf = ({
  winMatrix,
  variantNames,
  rowId,
  colId,
}: {
  winMatrix: BTLeaderboard["winMatrix"];
  variantNames: Record<string, string>;
  rowId: string;
  colId: string;
}) => {
  const wins = winMatrix[rowId]?.[colId] ?? 0;
  const losses = winMatrix[colId]?.[rowId] ?? 0;
  const total = wins + losses;
  const rate = total > 0 ? wins / total : null;
  const pair = `${variantNames[rowId] ?? rowId} vs ${variantNames[colId] ?? colId}`;
  const summary =
    rate === null
      ? "No matchups"
      : `${wins} wins / ${total} matchups (${Math.round(rate * 100)}%)`;
  return { wins, total, rate, pair, summary };
};

const focusableCellProps = ({
  rowId,
  colId,
  onCellClick,
}: {
  rowId: string;
  colId: string;
  onCellClick: (rowVariantId: string, colVariantId: string) => void;
}) => ({
  role: "button",
  tabIndex: 0,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onCellClick(rowId, colId);
    }
  },
  _focusVisible: {
    outline: "2px solid",
    outlineColor: "blue.focusRing",
  },
});

/** One head-to-head cell: how often the row variant beat the column variant. */
function WinMatrixCell({
  winMatrix,
  variantNames,
  rowId,
  colId,
  onCellClick,
}: {
  winMatrix: BTLeaderboard["winMatrix"];
  variantNames: Record<string, string>;
  rowId: string;
  colId: string;
  onCellClick?: (rowVariantId: string, colVariantId: string) => void;
}) {
  if (rowId === colId) {
    return (
      <Table.Cell textAlign="center" color="fg.muted">
        —
      </Table.Cell>
    );
  }

  const { wins, total, rate, pair, summary } = matchupOf({
    winMatrix,
    variantNames,
    rowId,
    colId,
  });
  const onClick = total > 0 ? onCellClick : undefined;

  return (
    <Table.Cell
      textAlign="center"
      bg={heatmapBg(rate)}
      cursor={onClick ? "pointer" : undefined}
      onClick={onClick ? () => onClick(rowId, colId) : undefined}
      // Only the cells that actually do something are focus stops. Making every
      // cell tabbable would put an N×N grid of dead targets in the tab order —
      // worse than no keyboard support, because it buries the real ones.
      {...(onClick
        ? focusableCellProps({ rowId, colId, onCellClick: onClick })
        : {})}
      // The visible cell is a bare number, which tells a screen reader nothing
      // about whose matchup it is or that activating it opens the judge's
      // reasoning.
      aria-label={
        onClick
          ? `${pair}: ${summary}. Show the judge's reasoning.`
          : `${pair}: ${summary}`
      }
      title={summary}
    >
      {total === 0 ? "—" : wins}
    </Table.Cell>
  );
}

function WinMatrixHeatmap({
  leaderboard,
  variantNames,
  onCellClick,
}: {
  leaderboard: BTLeaderboard;
  variantNames: Record<string, string>;
  onCellClick?: (rowVariantId: string, colVariantId: string) => void;
}) {
  // Render in the leaderboard's existing order (score desc), so the heatmap
  // reads top-left = strongest. Degenerate variants stay at the bottom for
  // consistency with the table. This ordering is also what keeps a large
  // (e.g. 10x10) matrix scannable rather than shrinking cells past legibility
  // — the table above stays the primary, always-legible view regardless of N.
  const ids = leaderboard.entries.map((e) => e.variantId);
  if (ids.length === 0) return null;

  // When every verdict covered the whole field, a win makes the winner beat
  // all the others at once, so each row is one number repeated. The grid then
  // shows how often each variant won — not how it fared against any one
  // opponent — and the per-cell tinting would otherwise imply a head-to-head
  // result the run never measured.
  const hasPairwiseDetail = winMatrixHasPairwiseDetail({
    winMatrix: leaderboard.winMatrix,
    variantIds: ids,
  });

  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Win matrix (row = winner, column = opponent) — click a cell for why
      </Text>
      {/*
        The note states only what the detector actually establishes.
        `winMatrixHasPairwiseDetail` tests whether any row VARIES across
        opponents. The previous copy went further and asserted why — "every
        verdict judged all N variants together" — a strictly stronger claim
        the check cannot support: eight strictly two-way rows produce uniform
        rows too, and there the sentence was simply untrue.
      */}
      {!hasPairwiseDetail ? (
        <Text fontSize="2xs" color="fg.muted">
          Each row here is the same number repeated — that variant&apos;s total
          wins, not a per-opponent tally, so the counts cannot tell you who it
          beat. The shading still can: it is how often the row variant won when
          those two met.
        </Text>
      ) : null}
      <Box overflowX="auto">
        <Table.Root size="sm" variant="outline">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader />
              {ids.map((id) => (
                <Table.ColumnHeader key={id} textAlign="center">
                  {variantNames[id] ?? id}
                </Table.ColumnHeader>
              ))}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {ids.map((rowId) => (
              <Table.Row key={rowId}>
                <Table.Cell fontWeight="medium">
                  {variantNames[rowId] ?? rowId}
                </Table.Cell>
                {ids.map((colId) => (
                  <WinMatrixCell
                    key={colId}
                    winMatrix={leaderboard.winMatrix}
                    variantNames={variantNames}
                    rowId={rowId}
                    colId={colId}
                    onCellClick={onCellClick}
                  />
                ))}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>
    </VStack>
  );
}

/**
 * Map win rate to a background tint:
 *   rate >= 0.5 → green (dominance)
 *   rate <  0.5 → red   (deficit)
 * Saturation scales with distance from 0.5. null → transparent (no matchups).
 * Uses Chakra token strings rather than raw hex so dark mode follows.
 */
function heatmapBg(rate: number | null): string | undefined {
  if (rate === null) return undefined;
  const delta = Math.abs(rate - 0.5);
  if (delta < 0.05) return "bg.muted";
  if (rate > 0.5) {
    if (delta > 0.3) return "green.muted";
    if (delta > 0.15) return "green.subtle";
    return "green.subtle";
  }
  if (delta > 0.3) return "red.muted";
  if (delta > 0.15) return "red.subtle";
  return "red.subtle";
}
