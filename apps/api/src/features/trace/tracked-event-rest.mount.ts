/**
 * Replays into the canonical route rather than redirecting (a 307 drops for
 * some clients), so both answer from the same auth chain.
 */
import { getRoutePolicy, registerRoutePolicy, type MountableRestApp } from "@langwatch/api/rest";
import { Hono } from "hono";

/** The URL every pre-rename SDK release posts a tracked event to. */
export const TRACKED_EVENT_LEGACY_PATH = "/api/track_event";
/** The URL the family actually registers. */
export const TRACKED_EVENT_CANONICAL_PATH = "/api/events/track";

/**
 * The canonical app is a parameter, not an import, so the two can't mount out
 * of step: no tracked-event ports composed means no alias mounted either.
 */
export function mountTrackedEventLegacyPathRest(options: {
  canonical: MountableRestApp;
}): MountableRestApp {
  const { canonical } = options;
  const app = new Hono();

  const canonicalRoute = getRoutePolicy("POST", TRACKED_EVENT_CANONICAL_PATH);
  if (!canonicalRoute) {
    throw new Error(
      `${TRACKED_EVENT_LEGACY_PATH} forwards to ${TRACKED_EVENT_CANONICAL_PATH}, which has ` +
        "declared no access policy; mount the canonical family before the alias",
    );
  }
  registerRoutePolicy({
    method: "POST",
    path: TRACKED_EVENT_LEGACY_PATH,
    policy: canonicalRoute.policy,
    family: canonicalRoute.family,
    credentialClass: canonicalRoute.credentialClass,
  });

  app.post(TRACKED_EVENT_LEGACY_PATH, async (c) => {
    const url = new URL(c.req.url);
    url.pathname = TRACKED_EVENT_CANONICAL_PATH;

    // The body is read here rather than streamed through: a `Request` built
    // from another request's stream needs `duplex: "half"` and is single-use,
    // and a tracked event is a few hundred bytes.
    const body = await c.req.arrayBuffer();

    return canonical.fetch(
      new Request(url.toString(), {
        method: "POST",
        headers: c.req.raw.headers,
        body,
      }),
      c.env,
    );
  });

  return app;
}
