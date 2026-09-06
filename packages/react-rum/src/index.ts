/**
 * `@langwatch/react-rum` — real user monitoring for React apps.
 *
 * Traces what happens in the browser and joins it to the traces the backend
 * already produces, so a click, the calls it fires and the server work behind
 * them read as one object rather than three unrelated ones.
 *
 * The host app is expected to proxy {@link RUM_TRACES_PATH} on its own origin
 * through to an OTLP collector: same-origin export means no CORS and no
 * internet-facing collector.
 *
 * See ADR-058 and specs/observability/browser-rum-trace-correlation.feature.
 */

export { startBrowserTracing } from "./browserTracing.ts";
export {
  ATTR_NAVIGATION_FROM_PATH,
  ATTR_NAVIGATION_SUPERSEDED,
  ATTR_NAVIGATION_TYPE,
  RUM_DEFAULT_SAMPLE_RATIO,
  RUM_MAX_BODY_BYTES,
  RUM_MAX_SPANS,
  RUM_SERVICE_NAME,
  RUM_SESSION_HEADER,
  RUM_TRACES_PATH,
} from "./constants.ts";
export type { NavigationSpanHandle, NavigationType } from "./navigation.ts";
export { startNavigationSpan } from "./navigation.ts";
// Exported because the ambient-navigation behaviour is only in effect when
// this manager is the registered one — an application assembling its own
// provider, or a test asserting navigation parentage, needs it by name.
export { NavigationContextManager } from "./navigationContextManager.ts";
export { currentSessionId, SESSION_INACTIVITY_MS } from "./session.ts";
export { SessionSpanProcessor } from "./sessionSpanProcessor.ts";
