/**
 * What every widget on a board is run with: the period from the address's `range` and `grain`,
 * and the header control's writes. One reading per board, so every widget updates together
 * (AC13). Live rolls; a fixed range re-ends on refresh.
 */

import { nowInstant } from "@langwatch/time";
import { useMemo, useState } from "react";

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  type BoardPeriod,
  boardGrainFits,
  boardPeriodBounds,
  boardPeriodGranularity,
  type BoardPeriodGrain,
  type BoardPeriodRange,
  boardWindowEnd,
  parseBoardPeriodGrain,
  parseBoardPeriodRange,
} from "../model/board-period.ts";

/** The address's range and grain, and the writes the header control makes. */
export function useBoardRange() {
  const host = useAnalyticsHost();
  const query = host.route().query;
  const range = parseBoardPeriodRange(query.range);
  const grain = parseBoardPeriodGrain(query.grain);

  return {
    range,
    grain,
    // Live and a range the grain cannot carry both go back to auto (AC19b, AC19c).
    setRange: (next: BoardPeriodRange) => {
      const resets =
        grain !== "auto" && (next === "live" || !boardGrainFits({ range: next, grain }));
      host.setQuery(resets ? { ...query, range: next, grain: "auto" } : { ...query, range: next });
    },
    setGrain: (next: BoardPeriodGrain) => host.setQuery({ ...query, grain: next }),
  };
}

/** `refreshedAt` is the board's auto-refresh clock; each move re-ends a fixed range at now. */
export function useBoardPeriod({ refreshedAt }: { refreshedAt?: number } = {}) {
  const board = useBoardRange();
  const { range, grain } = board;

  // When the range was picked, so a range change ends at now and a render does not.
  const [picked, setPicked] = useState(() => ({ range, at: nowInstant().epochMilliseconds }));
  if (picked.range !== range) setPicked({ range, at: nowInstant().epochMilliseconds });
  const windowEnd = boardWindowEnd({
    range,
    now: nowInstant().epochMilliseconds,
    pickedAt: picked.at,
    refreshedAt,
  });
  const { periodStart, periodEnd } = useMemo(
    () => boardPeriodBounds({ range, now: windowEnd }),
    [range, windowEnd],
  );
  const period: BoardPeriod = useMemo(
    () => ({
      periodStart,
      periodEnd,
      granularitySeconds: boardPeriodGranularity({ grain, periodStart, periodEnd }),
    }),
    [grain, periodStart, periodEnd],
  );

  return { ...board, period };
}
