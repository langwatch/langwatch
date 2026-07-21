/**
 * Constants shared by the browser tracer and the ingest route that accepts its
 * telemetry. They have to agree on all of these, and they live on opposite
 * sides of the network, so they are stated once here rather than twice.
 *
 * See ADR-058.
 */

/**
 * `service.name` the browser reports itself as. The ingest route refuses
 * anything claiming to be a different service, so this is also the value that
 * makes a payload acceptable.
 */
export const RUM_SERVICE_NAME = "langwatch-app-browser";

/** Same-origin path the browser exports to; proxied to the internal collector. */
export const RUM_TRACES_PATH = "/api/rum/v1/traces";

/**
 * Session the spans belong to, sent as a header so the ingest route can rate
 * limit per browser rather than per IP — an office or a NAT shares one address,
 * and limiting those together would throttle innocent users first.
 */
export const RUM_SESSION_HEADER = "x-langwatch-rum-session";

/**
 * Largest export body accepted, comfortably under the collector's own 32MB cap
 * so we reject with a clear answer rather than having the collector do it.
 */
export const RUM_MAX_BODY_BYTES = 1_000_000;
