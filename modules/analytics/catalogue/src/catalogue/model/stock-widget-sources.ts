/**
 * The trace sources a stock widget counts when they are not the default (dashboards-v2 AC202b,
 * AC202c; tasks#1025); a widget not listed counts `application`. The reviewed change table is
 * in `stock-widget-sources.unit.test.ts`.
 */

import {
  DEFAULT_WIDGET_SOURCES,
  TRACE_SOURCES,
  type TraceSource,
} from "@langwatch/analytics-contract";

const PRODUCTION: readonly TraceSource[] = ["application", "gateway"];

const NON_DEFAULT_SOURCES: Readonly<Record<string, readonly TraceSource[]>> = {
  // Slices spend by where it came from, so it counts every source.
  "cost-by-source": TRACE_SOURCES,
  // Production spend: what the widgets' own `Origin IN ('', 'application', 'gateway')` kept.
  "cost-waste": PRODUCTION,
  "voice-cost-per-call": PRODUCTION,
  "ext-cost-per-doc": PRODUCTION,
};

/** The sources a stock widget counts: its own list, else the default every query uses. */
export function stockWidgetSources(id: string): readonly TraceSource[] {
  return NON_DEFAULT_SOURCES[id] ?? DEFAULT_WIDGET_SOURCES;
}
