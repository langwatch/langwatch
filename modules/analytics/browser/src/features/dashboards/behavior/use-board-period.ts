/**
 * What every widget on a board is run with: the period from the address's `range` and `grain`
 * (`from` and `to` for a custom range), and the header control's writes. One reading per board,
 * so every widget updates together (AC13). Live rolls; a preset re-ends on refresh (AC19e).
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { nowInstant } from "@langwatch/time";
import { useState } from "react";

import { useAnalyticsHost } from "../../../model/analytics-host.ts";
import {
  type BoardCustomWindow,
  boardCustomQuery,
  boardGrainFits,
  type BoardPeriod,
  boardPeriodBounds,
  boardPeriodGranularity,
  type BoardPeriodGrain,
  type BoardPeriodPreset,
  type BoardRangeReading,
  boardRangeSpanMs,
  boardRefreshApplies,
  boardWindowEnd,
  parseBoardPeriodGrain,
  parseBoardRange,
} from "../model/board-period.ts";
import { periodChanged } from "../model/dashboard-usage-events.ts";

/** The address's range and grain, and the writes the header control makes. */
export function useBoardRange() {
  const host = useAnalyticsHost();
  const analytics = useUiAnalytics();
  const query = host.route().query;
  const reading = parseBoardRange({ range: query.range, from: query.from, to: query.to });
  const grain = parseBoardPeriodGrain(query.grain);

  /** Writes a new range; Live and a range the grain cannot carry go back to auto (AC19b, AC19c). */
  const writeRange = (next: BoardRangeReading) => {
    const resets =
      grain !== "auto" &&
      (next.range === "live" || !boardGrainFits({ spanMs: boardRangeSpanMs(next), grain }));
    const { from: _from, to: _to, ...rest } = query;
    host.setQuery({
      ...rest,
      range: next.range,
      ...(next.custom ? boardCustomQuery(next.custom) : {}),
      ...(resets ? { grain: "auto" } : {}),
    });
    // The address is written either way; only a new period is an event.
    if (next.range !== reading.range || next.custom || resets) {
      analytics.track(periodChanged({ range: next.range, grain: resets ? "auto" : grain }));
    }
  };

  return {
    reading,
    range: reading.range,
    custom: reading.custom,
    grain,
    /** Whether a refresh can bring anything new: not once a custom range has ended (AC19f). */
    refreshApplies: boardRefreshApplies({
      custom: reading.custom,
      now: nowInstant().epochMilliseconds,
    }),
    setRange: (range: BoardPeriodPreset) => writeRange({ range }),
    setCustom: (custom: BoardCustomWindow) => writeRange({ range: "custom", custom }),
    setGrain: (next: BoardPeriodGrain) => {
      host.setQuery({ ...query, grain: next });
      if (next !== grain) analytics.track(periodChanged({ range: reading.range, grain: next }));
    },
  };
}

/** `refreshedAt` is the board's auto-refresh clock; each move re-ends a preset range at now. */
export function useBoardPeriod({ refreshedAt }: { refreshedAt?: number } = {}) {
  const board = useBoardRange();
  const { reading, range, grain } = board;

  // When the range was picked, so a range change ends at now and a render does not.
  const [picked, setPicked] = useState(() => ({ range, at: nowInstant().epochMilliseconds }));
  if (picked.range !== range) setPicked({ range, at: nowInstant().epochMilliseconds });
  const { periodStart, periodEnd } =
    reading.range === "custom"
      ? { periodStart: reading.custom.from, periodEnd: reading.custom.to }
      : boardPeriodBounds({
          range: reading.range,
          now: boardWindowEnd({
            range: reading.range,
            now: nowInstant().epochMilliseconds,
            pickedAt: picked.at,
            refreshedAt,
          }),
        });
  const period: BoardPeriod = {
    periodStart,
    periodEnd,
    granularitySeconds: boardPeriodGranularity({ grain, periodStart, periodEnd }),
  };

  return { ...board, period };
}
