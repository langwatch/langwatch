/**
 * Turns a React Router navigation into a span.
 *
 * The router is the only thing that knows a navigation happened — the browser
 * fires no event for it — so the integration lives here, in the application
 * that owns the router, and `@langwatch/react-rum` stays router-agnostic.
 *
 * The shape of a navigation, as far as tracing is concerned:
 *
 *   begin   the router leaves `idle` (a lazy chunk, a loader) — or, for a route
 *           already in hand, the location simply changes and the router never
 *           leaves `idle` at all
 *   commit  the new location is on screen; the span's duration ends here,
 *           because this is what the user waited for
 *   settle  a frame later, the span stops being the parent for new work — the
 *           page dispatches its first queries from mount effects, which run
 *           between commit and paint, so one frame is what it takes to catch
 *           them
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */

import { useEffect, useRef } from "react";
import { useLocation, useMatches, useNavigation } from "react-router";

import {
  type NavigationSpanHandle,
  startNavigationSpan,
} from "@langwatch/react-rum";
import { usePublicEnv } from "./usePublicEnv";

/**
 * Backstop for the settle timer. `requestAnimationFrame` does not fire in a
 * background tab, and a navigation that never settles would leave its span
 * open and adopting every later fetch as a child. Losing the tail of a
 * backgrounded navigation is the cheaper failure.
 */
const SETTLE_DEADLINE_MS = 5_000;

/** React Router's key for the location a visit started on, which we do not trace. */
const INITIAL_LOCATION_KEY = "default";

export function useNavigationTracing(): void {
  const publicEnv = usePublicEnv();
  const enabled = !!publicEnv.data?.RUM_ENABLED;

  const navigation = useNavigation();
  const location = useLocation();
  // `useMatches` rather than `useParams`: this hook runs in the root layout,
  // and `useParams` there resolves against the root's own match — which has
  // none of the child route's params. The last match is the leaf, and its
  // params are the accumulated set.
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
    // `location.pathname` is only a fallback for a pending navigation with no
    // location of its own, and re-running when it changes would restart the
    // span the commit effect is about to close.
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
      route: routePatternOf(
        location.pathname,
        matches[matches.length - 1]?.params ?? {},
      ),
    });
    fromPathRef.current = location.pathname;
    settle(span);
    // `matches` and `location.pathname` are read at commit time and change
    // together with the key; depending on them would re-commit an already
    // committed navigation.
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
 * The route pattern behind a path — `/my-project/traces/abc123` read back as
 * `/:project/traces/:traceId`.
 *
 * Span names have to be low-cardinality to be worth anything: named by path,
 * every project and every trace id would be its own name and no aggregate
 * would exist to ask "how slow is the traces page". React Router does not hand
 * out the matched pattern, but it hands out the params, and substituting them
 * back segment by segment reconstructs it.
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
