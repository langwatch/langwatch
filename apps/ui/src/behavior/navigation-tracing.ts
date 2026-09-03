/**
 * Turns a React Router navigation into a span: begin, commit (span ends),
 * settle (one frame later, stops parenting new work). See ADR-058 and
 * `browser-rum-trace-correlation.feature`.
 */

import { type NavigationSpanHandle, startNavigationSpan } from "@langwatch/react-rum";
import { useEffect, useRef } from "react";
import { useLocation, useMatches, useNavigation } from "react-router";

/**
 * Backstop: `requestAnimationFrame` never fires in a background tab, and
 * an unsettled span would adopt every later fetch as a child.
 */
const SETTLE_DEADLINE_MS = 5_000;

/** React Router's key for the location a visit started on, which we do not trace. */
const INITIAL_LOCATION_KEY = "default";

export function useNavigationTracing({ enabled }: { enabled: boolean }): void {
  const navigation = useNavigation();
  const location = useLocation();
  // `useMatches`, not `useParams`: in the root layout, `useParams`
  // resolves against the root's own match, which has none of the child
  // route's params. The last match is the leaf, with the accumulated set.
  const matches = useMatches();

  const spanRef = useRef<NavigationSpanHandle | null>(null);
  const cancelSettleRef = useRef<(() => void) | null>(null);
  // Where this navigation came from. Only moved on once a navigation commits,
  // so a superseded one still reports the page the user actually left.
  const fromPathRef = useRef(location.pathname);

  const isNavigating = navigation.state !== "idle";
  const pendingPath = navigation.location?.pathname;
  const locationKey = location.key;

  const settle = (span: NavigationSpanHandle) => {
    cancelSettleRef.current?.();

    const finish = () => {
      cancelSettleRef.current = null;
      span.end();
      if (spanRef.current === span) spanRef.current = null;
    };

    const frame = requestAnimationFrame(finish);
    const deadline = setTimeout(finish, SETTLE_DEADLINE_MS);
    cancelSettleRef.current = () => {
      cancelAnimationFrame(frame);
      clearTimeout(deadline);
      cancelSettleRef.current = null;
    };
  };

  // Begin: the router has work to do before the next page can render.
  useEffect(() => {
    if (!enabled || !isNavigating) return;

    cancelSettleRef.current?.();
    spanRef.current = startNavigationSpan({
      toPath: pendingPath ?? location.pathname,
      fromPath: fromPathRef.current,
      navigationType: "resolved",
    });
    // `location.pathname` is a fallback only; re-running on its change
    // would restart the span the commit effect is about to close.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isNavigating, pendingPath]);

  // Commit: the new location is on screen. Also the whole of an instant
  // navigation, which never left `idle` for the effect above to notice.
  useEffect(() => {
    if (!enabled || isNavigating) return;

    // The first location of a visit is the document load, which the
    // document-load instrumentation already reports as its own span.
    if (locationKey === INITIAL_LOCATION_KEY) {
      fromPathRef.current = location.pathname;
      return;
    }

    const span =
      spanRef.current ??
      startNavigationSpan({
        toPath: location.pathname,
        fromPath: fromPathRef.current,
        navigationType: "instant",
      });
    spanRef.current = span;

    span.commit({
      route: routePatternOf(location.pathname, matches[matches.length - 1]?.params ?? {}),
    });
    fromPathRef.current = location.pathname;
    settle(span);
    // `matches`/`location.pathname` are read at commit time; depending on
    // them would re-commit an already-committed navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, isNavigating, locationKey]);

  // A navigation in flight when the app unmounts never arrives anywhere, but
  // its span still has to be closed and stood down as the ambient parent.
  useEffect(
    () => () => {
      cancelSettleRef.current?.();
      spanRef.current?.end();
      spanRef.current = null;
    },
    [],
  );
}

/**
 * `/my-project/traces/abc123` read back as `/:project/traces/:traceId` —
 * span names must be low-cardinality, and React Router hands out only the
 * params, not the matched pattern, so this reconstructs it from them.
 */
export function routePatternOf(
  pathname: string,
  params: Readonly<Record<string, string | undefined>>,
): string {
  const placeholderByValue = new Map<string, string>();
  for (const [name, value] of Object.entries(params)) {
    // A splat spans several segments and has no name worth substituting.
    if (!value || name === "*") continue;
    placeholderByValue.set(value, `:${name}`);
  }
  if (placeholderByValue.size === 0) return pathname;

  return pathname
    .split("/")
    .map((segment) => placeholderByValue.get(segment) ?? segment)
    .join("/");
}
