import { KNOWN_TRACE_ORIGINS } from "@langwatch/analytics-contract";

/**
 * A trace's source in SQL: a listed origin as itself, a missing or empty one as application,
 * any other as `other` (dashboards-v2 AC200l, AC202e).
 */
export function sourceOfOrigin(origin: string): string {
  const listed = KNOWN_TRACE_ORIGINS.map((known) => `'${known}'`).join(", ");

  return `multiIf(ifNull(${origin}, '') = '', 'application', ${origin} IN (${listed}), ifNull(${origin}, ''), 'other')`;
}
