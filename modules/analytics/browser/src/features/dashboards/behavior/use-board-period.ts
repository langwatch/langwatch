/**
 * The period every widget on a board reads over, from the address's `range`
 * and `grain`, and the writes the header control makes. One reading per
 * board, so every widget updates together (AC13). Live rolls on the minute.
 */

import { nowInstant } from "@langwatch/time";
import { useMemo } from "react";

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  type BoardPeriod,
  boardGrainFits,
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

  // Fixed per range change so widgets do not refetch on each render; Live moves on each minute.
  const liveEnd =
    range === "live" ? Math.ceil(nowInstant().epochMilliseconds / 60_000) * 60_000 : 0;
  const { periodStart, periodEnd } = useMemo(
    () => boardPeriodBounds({ range, now: liveEnd || nowInstant().epochMilliseconds }),
    [range, liveEnd],
  );
  const period: BoardPeriod = useMemo(
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
    // Live and a range the grain cannot carry both go back to auto (AC19b, AC19c).
    setRange: (next: BoardPeriodRange) => {
      const resets =
        grain !== "auto" && (next === "live" || !boardGrainFits({ range: next, grain }));
      host.setQuery(resets ? { ...query, range: next, grain: "auto" } : { ...query, range: next });
    },
    setGrain: (next: BoardPeriodGrain) => host.setQuery({ ...query, grain: next }),
  };
}
