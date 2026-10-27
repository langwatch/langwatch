/** Summary strip showing pre-formatted figures; holds no queries or sums. */

import { Box } from "@langwatch/design-system/primitives";
import { StatTile, StatTileFigure, StatTileGrid } from "@langwatch/design-system/stat-tile";

import type { GovernanceSummaryBarItem } from "../../model/governance-summary-bar-item.ts";

export type { GovernanceSummaryBarItem };

/**
 * What a figure reads as when nothing measured it: an em dash, never a
 * zero (a measurement, and a lie here) and never a spinner (the page is
 * done, it just has no answer).
 */
export const GOVERNANCE_SUMMARY_UNMEASURED = "—";

/** Row of raised tiles, one per figure, that wraps to columns rather than scroll. */
export function GovernanceSummaryBar({
  items,
  testId,
}: {
  items: readonly GovernanceSummaryBarItem[];
  testId?: string;
}) {
  // No figures, no tiles. An empty row reads as a component that failed to
  // load rather than a page with nothing to summarize.
  if (items.length === 0) return null;

  return (
    <Box data-testid={testId} width="full">
      <StatTileGrid columns={items.length}>
        {items.map((item) => (
          <StatTile
            key={item.key}
            variant="showcase"
            label={item.label}
            icon={item.icon}
            hint={item.hint}
            data-testid={testId ? `${testId}-${item.key}` : void 0}
          >
            <StatTileFigure>{item.value ?? GOVERNANCE_SUMMARY_UNMEASURED}</StatTileFigure>
          </StatTile>
        ))}
      </StatTileGrid>
    </Box>
  );
}
