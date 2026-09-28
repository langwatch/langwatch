/**
 * The period every block on a board reads over, from the address's `range`
 * and `grain`, and the writes the header control makes. One reading per
 * board, so every block updates together (AC13).
 */

import { nowInstant } from "@langwatch/time";
import { useMemo } from "react";

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import type { BlockPeriod } from "../blocks/index.ts";
import {
  boardPeriodBounds,
  boardPeriodGranularity,
  type BoardPeriodGrain,
  type BoardPeriodRange,
  parseBoardPeriodGrain,
  parseBoardPeriodRange,
} from "../model/board-period.ts";

export function useBoardPeriod() {
  const host = useAnalyticsHost();
  const query = host.route().query;
  const range = parseBoardPeriodRange(query.range);
  const grain = parseBoardPeriodGrain(query.grain);

  // Fixed once per range change, not every render, so blocks don't refetch on each rerender.
  const { periodStart, periodEnd } = useMemo(
    () => boardPeriodBounds({ range, now: nowInstant().epochMilliseconds }),
    [range],
  );
  const period: BlockPeriod = useMemo(
    () => ({
      periodStart,
      periodEnd,
      granularitySeconds: boardPeriodGranularity({ grain, periodStart, periodEnd }),
    }),
    [grain, periodStart, periodEnd],
  );

  return {
    range,
    grain,
    period,
    setRange: (next: BoardPeriodRange) => host.setQuery({ ...query, range: next }),
    setGrain: (next: BoardPeriodGrain) => host.setQuery({ ...query, grain: next }),
  };
}
