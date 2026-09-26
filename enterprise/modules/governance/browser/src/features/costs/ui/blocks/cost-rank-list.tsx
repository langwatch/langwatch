// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { getHexColorForString } from "@langwatch/design-system/rotating-colors";
import { type ReactNode, useMemo } from "react";

import { fmtMoney } from "../../model/cost-figure-format.ts";
import { rankBarGeometry, type RankBar } from "../../model/rank-bars.ts";
import { type RankRow } from "../../model/sample-series.ts";
import { EmptyPanel } from "./cost-chart-parts.tsx";

/**
 * The bar half of a ranked row.
 *
 * Its own component for the reason `CostSpenderPanel` splits `SpenderBar` out:
 * the branch on a credit touches five properties, and inlined it buries the
 * row's shape under styling the row does not decide.
 */
function RankBarCell({ row }: { row: RankBar }) {
  return (
    <Box flex="1" height="14px" borderRadius="sm" backgroundColor="bg.muted" overflow="hidden">
      <Box
        height="100%"
        borderRadius="sm"
        width={`${row.widthPct}%`}
        // The same number, readable without resolving styling — the width
        // above lands in a generated class name. `MeterBar` does the same for
        // the same reason.
        data-width-pct={row.widthPct}
        data-credit={row.isCredit ? "true" : undefined}
        // A credit is drawn as an outline rather than a fill, so a refund and
        // a charge of the same size do not read alike.
        backgroundColor={row.isCredit ? "transparent" : getHexColorForString(row.label)}
        borderWidth={row.isCredit ? "2px" : undefined}
        borderColor={row.isCredit ? getHexColorForString(row.label) : undefined}
      />
    </Box>
  );
}

/**
 * The figure half of a ranked row, or the dash that stands in for one.
 *
 * A WITHHELD figure prints no number. Formatting its placeholder would put
 * "$0" where the screen means "we hold rows we cannot price", and the two
 * readings are not close enough for a reader to tell apart.
 */
function RankFigure({ row, format }: { row: RankBar; format: (value: number) => string }) {
  return (
    <Text
      flex="0 0 18%"
      textAlign="right"
      fontVariantNumeric="tabular-nums"
      // Readable without resolving styling, as `data-width-pct` is: an em dash
      // alone cannot tell a test which of the two things it means, and the
      // reason is what a reader is owed here.
      data-unpriced={row.unpriced ? "true" : undefined}
      color={row.unpriced ? "fg.muted" : undefined}
      // The word the dash stands for, since the column is too narrow to print
      // it. Same sentence the spender panel uses for the same withholding, so
      // the two panels do not explain it differently.
      title={
        row.unpriced
          ? `unpriced: ${row.unpricedCells ?? 0} of this row's cells hold no US-dollar figure, so no total is shown`
          : undefined
      }
    >
      {row.unpriced ? "—" : format(row.value)}
    </Text>
  );
}

/**
 * Ranked horizontal bars — label, bar, figure. Rows are ordered by what was
 * spent, and each bar is scaled against the largest figure rather than the
 * total, so a long tail stays legible instead of collapsing into slivers.
 * `rankBarGeometry` explains why "largest" means largest magnitude.
 */
export function CostRankList({
  rows,
  format = fmtMoney,
  maxRows = 8,
  empty,
}: {
  rows: RankRow[] | null;
  format?: (value: number) => string;
  maxRows?: number;
  /** This panel's own empty state. See `costPanelEmpty`. */
  empty?: (unanswered: boolean) => ReactNode;
}) {
  const shown = useMemo(
    // Copied before sorting: these rows can be a query cache, and sorting in
    // place would reorder what every other reader of that cache sees.
    //
    // WITHHELD rows sort last whatever their placeholder value says. Ranking
    // them by it would file a row nobody could price among the figures, and
    // its stand-in zero would land it above every credit on the panel.
    () =>
      rankBarGeometry(
        [...(rows ?? [])]
          .toSorted(
            (a, b) =>
              Number(a.unpriced ?? false) - Number(b.unpriced ?? false) || b.value - a.value,
          )
          .slice(0, maxRows),
      ),
    [rows, maxRows],
  );

  if (rows === null) return <EmptyPanel height="220px" unanswered empty={empty} />;
  if (shown.length === 0) return <EmptyPanel height="220px" unanswered={false} empty={empty} />;

  return (
    <VStack align="stretch" gap={2}>
      {shown.map((row) => (
        <HStack key={row.key} gap={3} fontSize="sm">
          {/* Half the row, because these labels are agent slugs and email
              addresses — `genie-revenue-analyst` and `genie-supply-planner`
              share a prefix long enough that a third of the row truncated
              them to the same string, and two rows that read alike are worse
              than a shorter bar. The full value is on hover either way. */}
          <Text flex="0 0 50%" minWidth={0} truncate title={row.label}>
            {row.label}
          </Text>
          <RankBarCell row={row} />
          <RankFigure row={row} format={format} />
        </HStack>
      ))}
    </VStack>
  );
}
