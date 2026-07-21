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

export {
  RUM_MAX_BODY_BYTES,
  RUM_SERVICE_NAME,
  RUM_SESSION_HEADER,
  RUM_TRACES_PATH,
} from "./constants";
export {
  resetBrowserTracingForTesting,
  startBrowserTracing,
} from "./browserTracing";
export { currentSessionId, SESSION_INACTIVITY_MS } from "./session";
export { SessionSpanProcessor } from "./sessionSpanProcessor";
export { tracingLink } from "./trpcTracingLink";
