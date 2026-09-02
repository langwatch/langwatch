/**
 * The datapoint step each dashboard widget runs at, held in URL state.
 *
 * Where it lives is the whole point. `CustomGraph` has no `granularitySeconds`
 * column, and adding one is a migration this slice does not own — but the
 * alternative that reaches for component state loses the pick on reload and,
 * worse, drops it out of a shared link: a member who coarsens a card to make it
 * readable and pastes the URL into a thread sends their colleague a different
 * chart from the one they are describing. The dashboard's period already lives
 * in the URL for exactly that reason (`usePeriodSelector`), so the step goes
 * beside it and travels the same way.
 *
 * Encoded as one `widgetGranularity` parameter holding `id:seconds` pairs —
 * `?widgetGranularity=chart_a:3600,chart_b:1` — rather than a parameter per
 * card, so a dashboard of twenty widgets cannot turn the query string into
 * twenty keys, and so the whole picker state is one thing to read, write and
 * clear.
 *
 * Only offered steps are accepted on the way in. A URL is user-editable, and a
 * hand-typed `chart_a:7200` would otherwise reach the run as a step the
 * contract refuses — an error on a shared link, in place of a chart.
 *
 * @see ./use-analytics-period — the period half of the same URL state
 * @see specs/analytics/lwql-saved-charts.feature
 */

import { useCallback, useMemo } from "react";
import type { LangWatchQLGranularityStep } from "@langwatch/analytics-contract";

import { LWQL_GRANULARITY_STEPS } from "@langwatch/analytics-contract";
import { useAnalyticsHost } from "../model/analytics-host";

/** The query parameter the whole picker state is encoded into. */
export const WIDGET_GRANULARITY_QUERY_PARAMETER = "widgetGranularity";

const isOfferedStep = (seconds: number): seconds is LangWatchQLGranularityStep =>
  (LWQL_GRANULARITY_STEPS as readonly number[]).includes(seconds);

/**
 * Decodes `id:seconds,id:seconds` into a lookup.
 *
 * Malformed entries are dropped rather than throwing: the source is a URL a
 * member can hand-edit, and a typo should cost the pick it names, not the page.
 */
export function parseWidgetGranularity(
  encoded: string | undefined,
): Readonly<Record<string, LangWatchQLGranularityStep>> {
  if (!encoded) return {};

  const parsed: Record<string, LangWatchQLGranularityStep> = {};
  for (const entry of encoded.split(",")) {
    const separator = entry.lastIndexOf(":");
    if (separator <= 0) continue;

    const graphId = entry.slice(0, separator);
    const seconds = Number(entry.slice(separator + 1));
    if (!Number.isInteger(seconds) || !isOfferedStep(seconds)) continue;

    parsed[graphId] = seconds;
  }
  return parsed;
}

/** Encodes a lookup back into the parameter, sorted so the URL is stable. */
export function encodeWidgetGranularity(
  picks: Readonly<Record<string, LangWatchQLGranularityStep>>,
): string {
  return Object.keys(picks)
    .sort()
    .map((graphId) => `${graphId}:${picks[graphId]}`)
    .join(",");
}

export interface WidgetGranularityState {
  /** The step each card was picked to run at, by graph id. */
  readonly granularityByGraphId: Readonly<Record<string, LangWatchQLGranularityStep>>;
  /** Records a member's pick for one card, into the URL. */
  readonly setGranularity: (graphId: string, granularitySeconds: number) => void;
}

export function useWidgetGranularity(): WidgetGranularityState {
  const host = useAnalyticsHost();
  const { query } = host.route();
  const encodedValue = query[WIDGET_GRANULARITY_QUERY_PARAMETER];

  const granularityByGraphId = useMemo(() => parseWidgetGranularity(encodedValue), [encodedValue]);

  const setGranularity = useCallback(
    (graphId: string, granularitySeconds: number) => {
      // Refused rather than written: the picker only offers the three steps,
      // so anything else is a caller bug, and writing it would put a URL into
      // circulation that fails on open.
      if (!isOfferedStep(granularitySeconds)) return;

      const next = encodeWidgetGranularity({
        ...parseWidgetGranularity(encodedValue),
        [graphId]: granularitySeconds,
      });

      // Same route, query only: the picks are read from the address on
      // render, so the dashboard re-renders without remounting and only the
      // card whose step changed re-runs. A WHOLE-query write, so clearing the
      // last pick removes the parameter rather than leaving an empty one.
      host.setQuery({
        ...query,
        [WIDGET_GRANULARITY_QUERY_PARAMETER]: next ? next : void 0,
      });
    },
    [encodedValue, host, query],
  );

  return { granularityByGraphId, setGranularity };
}
