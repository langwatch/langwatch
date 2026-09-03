/**
 * The whole address, as a string.
 *
 * `UiRoutePort` answers with path parameters and the query string, which is
 * what a screen normally wants and all any family before this one asked for.
 * Deja View wants more: it keeps its entire workspace — the searched query, the
 * selected aggregate, the event cursor, the chosen projection — in the URL
 * FRAGMENT, reads it once to seed that state and writes it back with
 * `history.replaceState`. A params-and-query reading carries no fragment, so
 * the ops family's host answers `asPath()` from here instead.
 *
 * It lives in global behaviour rather than in the feature for the usual reason:
 * `react-router` is one of the imports ADR-004 seals off from `src/features/*`,
 * and this module is the seam that keeps it out of them.
 */

import { useLocation } from "react-router";

export function useUiAddress(): string {
  const location = useLocation();
  return `${location.pathname}${location.search}${location.hash}`;
}
