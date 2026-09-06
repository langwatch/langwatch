/**
 * Constants shared by the browser tracer and the ingest route that accepts its
 * telemetry. They have to agree on all of these, and they live on opposite
 * sides of the network, so they are stated once here rather than twice.
 *
 * See ADR-058.
 */

/**
 * `service.name` the browser reports itself as. The ingest route overwrites
 * whatever a payload claims with this value, so browser telemetry can never be
 * attributed to another service.
 */
export const RUM_SERVICE_NAME = "langwatch-app-browser";

/** Same-origin path the browser exports to; proxied to the internal collector. */
export const RUM_TRACES_PATH = "/api/rum/v1/traces";

/**
 * Instrumentation scope for the spans this package opens itself (navigation),
 * as opposed to the ones the off-the-shelf instrumentations open.
 */
export const RUM_INSTRUMENTATION_NAME = "@langwatch/react-rum";

/**
 * Share of *sessions* recorded when nothing says otherwise. Always-on: the
 * population is internal and the value of a complete visit is high. See
 * `sampling.ts` for why this is the number to change first when volume bites.
 */
export const RUM_DEFAULT_SAMPLE_RATIO = 1;

/**
 * How a navigation resolved — `resolved` when the router had work to do
 * (a lazy chunk, a loader), `instant` when the route was already in hand.
 * Not a semantic convention; browser navigation has none.
 */
export const ATTR_NAVIGATION_TYPE = "langwatch.navigation.type";

/** Path navigated away from, so a slow route can be read in context. */
export const ATTR_NAVIGATION_FROM_PATH = "langwatch.navigation.from_path";

/**
 * Set when the user navigated away before this navigation finished. Without
 * it an abandoned navigation is indistinguishable from a fast one.
 */
export const ATTR_NAVIGATION_SUPERSEDED = "langwatch.navigation.superseded";

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

/**
 * Largest number of spans accepted in one export. The byte cap alone is not a
 * bound on work: minimal spans are small, so a body under the size limit can
 * still carry thousands of them. A browser exporting more than this in a single
 * batch is malfunctioning or malicious either way.
 */
export const RUM_MAX_SPANS = 2_000;
