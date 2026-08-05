/**
 * Navigation spans: an in-app route change as a unit of work.
 *
 * Document load is one span at the start of a visit; everything after it is a
 * client-side navigation the browser never tells anyone about. Without this,
 * the calls a page makes on arrival are orphan traces with no statement of what
 * the user was doing, and "opening the traces page is slow" has nothing to
 * measure it against.
 *
 * Router-agnostic on purpose: the router lives in the application, so the
 * application drives this — begin when the router starts navigating, name the
 * route once it commits, settle when the new page has had its chance to fetch.
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */

import {
  type Context,
  ROOT_CONTEXT,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import {
  ATTR_HTTP_ROUTE,
  ATTR_URL_PATH,
} from "@opentelemetry/semantic-conventions";

import {
  ATTR_NAVIGATION_FROM_PATH,
  ATTR_NAVIGATION_SUPERSEDED,
  ATTR_NAVIGATION_TYPE,
  RUM_INSTRUMENTATION_NAME,
} from "./constants";
import {
  clearAmbientContext,
  resetAmbientContextForTesting,
  setAmbientContext,
} from "./navigationContextManager";

/** How the navigation was resolved, for telling a lazy route from an instant one. */
export type NavigationType = "resolved" | "instant";

export interface NavigationSpanHandle {
  /**
   * Marks the moment the new route is on screen, naming the span for it.
   *
   * Separate from {@link NavigationSpanHandle.end} because the two answer
   * different questions. The span's *duration* should be what the user waited
   * — click to page — so it is measured to here. Its life as the ambient
   * parent has to run a little longer, because the page dispatches its first
   * fetches immediately after this.
   *
   * The route pattern arrives here rather than at the start because it is only
   * knowable once the router has matched it: while the navigation is in flight
   * the application still holds the previous route's params.
   */
  commit({ route }: { route?: string }): void;
  /** Records that the navigation failed rather than completed. */
  fail(error: unknown): void;
  /** Ends the span and withdraws it as the ambient parent. */
  end(): void;
}

/** No-op handle, so callers never branch on whether tracing is on. */
const inertHandle: NavigationSpanHandle = {
  commit: () => void 0,
  fail: () => void 0,
  end: () => void 0,
};

let inFlight: { span: Span; context: Context } | undefined;

/**
 * Begins a navigation span and publishes it as the ambient parent for the
 * fetches the navigation triggers.
 *
 * A navigation started while another is in flight supersedes it: the tab is
 * going somewhere else, and the first navigation's outcome is no longer
 * something anyone waits for.
 */
export function startNavigationSpan({
  toPath,
  fromPath,
  navigationType = "resolved",
}: {
  toPath: string;
  fromPath?: string;
  navigationType?: NavigationType;
}): NavigationSpanHandle {
  try {
    if (inFlight) endInFlight();

    const span = trace.getTracer(RUM_INSTRUMENTATION_NAME).startSpan(
      navigationName(toPath),
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          [ATTR_URL_PATH]: toPath,
          [ATTR_NAVIGATION_TYPE]: navigationType,
          ...(fromPath ? { [ATTR_NAVIGATION_FROM_PATH]: fromPath } : {}),
        },
      },
      // Explicitly rooted. A navigation is its own unit of work; inheriting
      // whatever span happened to be open when the user clicked — the
      // superseded navigation, or a fetch callback that called `navigate` —
      // would bury it inside an unrelated trace.
      ROOT_CONTEXT,
    );

    const spanContext = trace.setSpan(ROOT_CONTEXT, span);
    inFlight = { span, context: spanContext };
    setAmbientContext(spanContext);

    return handleFor(span, spanContext);
  } catch {
    // Untraced navigation beats a broken one.
    return inertHandle;
  }
}

function handleFor(span: Span, spanContext: Context): NavigationSpanHandle {
  const isCurrent = () => inFlight?.span === span;
  let committedAt: number | undefined;

  return {
    commit({ route }: { route?: string }) {
      try {
        committedAt ??= Date.now();
        if (route) {
          span.updateName(navigationName(route));
          span.setAttribute(ATTR_HTTP_ROUTE, route);
        }
      } catch {
        // Best effort; the span keeps the name and duration it would have had.
      }
    },
    fail(error: unknown) {
      try {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // Best effort.
      }
    },
    end() {
      try {
        // A superseded navigation has already been ended by its successor, and
        // the ambient context now belongs to that successor.
        if (!isCurrent()) return;
        inFlight = void 0;
        clearAmbientContext(spanContext);
        span.end(committedAt);
      } catch {
        // Best effort.
      }
    },
  };
}

/**
 * Ends the navigation in flight because another has started. Marked, because
 * otherwise an abandoned navigation reads as a completed one that happened to
 * be fast.
 */
function endInFlight(): void {
  if (!inFlight) return;
  const { span, context } = inFlight;
  inFlight = void 0;
  clearAmbientContext(context);
  span.setAttribute(ATTR_NAVIGATION_SUPERSEDED, true);
  span.end();
}

/**
 * Named by route rather than by URL. A path carries ids, so naming spans after
 * it would produce one span name per project per page — unqueryable, and the
 * reason `http.route` exists.
 */
const navigationName = (route: string): string => `navigation ${route}`;

/** Test seam: forgets any in-flight navigation without ending it. */
export function resetNavigationForTesting(): void {
  inFlight = void 0;
  resetAmbientContextForTesting();
}
