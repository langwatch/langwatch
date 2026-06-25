import {
  Box,
  Button,
  HStack,
  Icon,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useMemo, useState } from "react";
import {
  LuArrowDown,
  LuArrowUp,
  LuArrowUpDown,
  LuRocket,
  LuTriangleAlert,
} from "react-icons/lu";
import type { BTLeaderboard } from "../utils/computeBTLeaderboard";

/**
 * Bradley-Terry leaderboard panel for the pairwise / N-way compare evaluator
 * (#5103). Purely presentational — caller computes `leaderboard` via
 * `computeBTLeaderboard` and passes it in. Mirrors the prop-driven shape
 * of `AggregateHeaderBar`. Gated by the
 * `release_ui_pairwise_bt_aggregation_enabled` flag at the mount site.
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
  /** Optional promote handoff. Hidden when not provided. */
  onPromote?: (variantId: string) => void;
};

type SortKey = "rank" | "score" | "winRate" | "matchups";
type SortDir = "asc" | "desc";

const DEFAULT_WARN_THRESHOLD = 30;

export function PairwiseLeaderboard({
  leaderboard,
  variantNames,
  warnThreshold = DEFAULT_WARN_THRESHOLD,
  onPromote,
}: PairwiseLeaderboardProps) {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Stable rank derived from incoming entry order — entries arrive sorted by
  // score desc (degenerate sunk). Rank stays attached to the variant when the
  // user re-sorts by another column.
  const ranked = useMemo(
    () =>
      leaderboard.entries.map((e, i) => ({
        ...e,
        rank: i + 1,
        name: variantNames[e.variantId] ?? e.variantId,
      })),
    [leaderboard.entries, variantNames],
  );

  const sorted = useMemo(() => {
    const arr = [...ranked];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "score":
          return (a.score - b.score) * dir;
        case "winRate":
          return ((a.winRate ?? -1) - (b.winRate ?? -1)) * dir;
        case "matchups":
          return (a.matchups - b.matchups) * dir;
        case "rank":
        default:
          return (a.rank - b.rank) * dir;
      }
    });
    return arr;
  }, [ranked, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  };

  const lowSample = leaderboard.minMatchups < warnThreshold;

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
          Leaderboard (Bradley-Terry, 95% CI)
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {leaderboard.comparisonCount} comparisons · min{" "}
          {leaderboard.minMatchups} per variant
        </Text>
      </HStack>

      {lowSample ? (
        <WarnBanner
          tone="warning"
          icon={LuTriangleAlert}
          text={`Sample size low — at least one variant has fewer than ${warnThreshold} matchups. BT scores may be unstable.`}
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
                label="BT score (± 95% CI)"
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
              {onPromote ? <Table.ColumnHeader /> : null}
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {sorted.map((e) => (
              <Table.Row key={e.variantId}>
                <Table.Cell>{e.rank}</Table.Cell>
                <Table.Cell>
                  <HStack gap={2}>
                    <Text>{e.name}</Text>
                    {e.degenerate ? (
                      <Text fontSize="xs" color="fg.muted">
                        (degenerate)
                      </Text>
                    ) : null}
                  </HStack>
                </Table.Cell>
                <Table.Cell>{formatScoreWithCI(e.score, e.scoreCI)}</Table.Cell>
                <Table.Cell>
                  {e.winRate === null
                    ? "—"
                    : `${Math.round(e.winRate * 100)}%`}
                </Table.Cell>
                <Table.Cell>{e.matchups}</Table.Cell>
                {onPromote ? (
                  <Table.Cell>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => onPromote(e.variantId)}
                    >
                      <Icon as={LuRocket} boxSize="14px" />
                      Promote
                    </Button>
                  </Table.Cell>
                ) : null}
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Box>

      <WinMatrixHeatmap
        leaderboard={leaderboard}
        variantNames={variantNames}
      />
    </VStack>
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
  const ArrowIcon = !active ? LuArrowUpDown : sortDir === "asc" ? LuArrowUp : LuArrowDown;
  return (
    <Table.ColumnHeader>
      <HStack
        gap={1}
        cursor="pointer"
        onClick={() => onSort(col)}
        userSelect="none"
      >
        <Text>{label}</Text>
        <Icon as={ArrowIcon} boxSize="12px" color={active ? "fg" : "fg.muted"} />
      </HStack>
    </Table.ColumnHeader>
  );
}

function formatScoreWithCI(
  score: number,
  ci: [number, number] | null,
): string {
  const rounded = score.toFixed(2);
  if (!ci) return rounded;
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

function WinMatrixHeatmap({
  leaderboard,
  variantNames,
}: {
  leaderboard: BTLeaderboard;
  variantNames: Record<string, string>;
}) {
  // Render in the leaderboard's existing order (score desc), so the heatmap
  // reads top-left = strongest. Degenerate variants stay at the bottom for
  // consistency with the table.
  const ids = leaderboard.entries.map((e) => e.variantId);
  if (ids.length === 0) return null;

  return (
    <VStack align="stretch" gap={2}>
      <Text fontSize="xs" fontWeight="semibold" color="fg.muted">
        Win matrix (row = winner, column = opponent)
      </Text>
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
                {ids.map((colId) => {
                  if (rowId === colId) {
                    return (
                      <Table.Cell key={colId} textAlign="center" color="fg.muted">
                        —
                      </Table.Cell>
                    );
                  }
                  const w = leaderboard.winMatrix[rowId]?.[colId] ?? 0;
                  const l = leaderboard.winMatrix[colId]?.[rowId] ?? 0;
                  const total = w + l;
                  const rate = total > 0 ? w / total : null;
                  return (
                    <Table.Cell
                      key={colId}
                      textAlign="center"
                      bg={heatmapBg(rate)}
                      title={
                        rate === null
                          ? "No matchups"
                          : `${w} wins / ${total} matchups (${Math.round(rate * 100)}%)`
                      }
                    >
                      {total === 0 ? "—" : w}
                    </Table.Cell>
                  );
                })}
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
