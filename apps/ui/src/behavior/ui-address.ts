/**
 * The whole address, as a string — `UiRoutePort` answers only path and
 * query, but Deja View keeps its workspace state in the URL FRAGMENT, so
 * the ops host reads `asPath()` from here instead.
 */

import { useLocation } from "react-router";

export function useUiAddress(): string {
  const location = useLocation();
  return `${location.pathname}${location.search}${location.hash}`;
}
