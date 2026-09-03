/**
 * `POST /api/track_event`, served from the canonical `POST /api/events/track`.
 *
 * The two URLs are one endpoint. The legacy path predates the canonical one
 * and every SDK release older than the rename still posts to it, so it cannot
 * be retired — but it must not be a SECOND handler either: two handlers over
 * one recorder is two answers to "was this event accepted", and the pair drift
 * the first time one of them gains a validation the other does not. So the
 * request is replayed against the canonical route rather than re-implemented,
 * which is the shape `createOtlpPathAliasRestApp` already uses for the OTLP
 * paths a misconfigured exporter produces.
 *
 * NOT A REDIRECT, for the same reason that one is not: the callers here are
 * SDKs and server-to-server scripts, and a 307 replayed by some HTTP clients
 * and dropped by others would repair part of the fleet and silently lose the
 * rest.
 *
 * Raw Hono rather than a secured app, because this app TERMINATES NOTHING. It
 * declares no access policy: the canonical route authenticates the forwarded
 * request exactly as it would a direct one, so the legacy URL answers the same
 * 200, 400, 401 and 403 the canonical URL does, from the same chain.
 */
import type { MountableRestApp } from "@langwatch/api/rest";
import { Hono } from "hono";

/** The URL every pre-rename SDK release posts a tracked event to. */
export const TRACKED_EVENT_LEGACY_PATH = "/api/track_event";
/** The URL the family actually registers. */
export const TRACKED_EVENT_CANONICAL_PATH = "/api/events/track";

/**
 * Builds the re-dispatcher over the canonical tracked-event app.
 *
 * The canonical app is a parameter rather than an import so the two cannot be
 * mounted out of step: a process that composed no tracked-event ports has
 * nothing to pass here and mounts no alias either, which is the correct
 * outcome — an alias forwarding into a family nobody built would answer 404
 * from a route that looks like it exists.
 */
export function mountTrackedEventLegacyPathRest(options: {
  canonical: MountableRestApp;
}): MountableRestApp {
  const { canonical } = options;
  const app = new Hono();

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
