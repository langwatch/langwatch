/**
 * Serves the OTLP paths a misconfigured exporter produces from the canonical
 * handlers in `./otel`.
 *
 * Not a redirect. An OTLP exporter is not a browser and the two largest client
 * stacks will not follow one: OkHttp, under the Java exporter, refuses to
 * replay a POST across 307/308, and the Node exporter issues its request
 * through `http.request` with no redirect handling at all. A redirect would
 * repair part of the fleet and go on silently dropping the rest, so the request
 * is replayed internally instead — the same shape as the experiments-v3 legacy
 * alias.
 *
 * MOUNT ORDER: this app must be registered after `otelApp` and `collectorApp`
 * so the canonical routes and the collector's own POST match first. The
 * wildcards below are broad on purpose — the decision lives in
 * `canonicalOtlpPath`, which is an allow-list — and anything they catch that is
 * not a known misconfiguration is passed straight on, so a namespace mounted
 * after this one keeps its own routing and its own 404.
 *
 * Raw Hono rather than a SecuredApp on purpose: this app declares no access
 * policy because it terminates nothing. It rewrites the path and hands the
 * request to the canonical route, which authenticates it exactly as it would
 * any other — a corrected path is refused for want of credentials the same way
 * the canonical one is, and the spec pins that.
 *
 * See specs/otlp/endpoint-path-canonicalisation.feature.
 */

import { Hono } from "hono";
import { appContextBindingsFor } from "~/app/api/middleware/app-context";
import {
  canonicalOtlpPath,
  stampCorrectedPath,
} from "~/server/otel/otlpPathCanonicalisation";
import { app as otelApp } from "./otel";

export const app = new Hono();

/**
 * Every namespace a recognised misconfiguration can land in. `/v1/*` is only
 * reachable because start.ts routes root-level OTLP paths into the API — left
 * to the SPA fallback it answered with the HTML shell and a 200, which an
 * exporter reads as success before dropping the batch.
 */
const CANDIDATE_PATTERNS = ["/api/otel/*", "/api/collector/*", "/api/v1/*", "/v1/*"];

for (const pattern of CANDIDATE_PATTERNS) {
  app.all(pattern, async (c, next) => {
    const url = new URL(c.req.url);
    const originalPath = url.pathname;

    const canonical = canonicalOtlpPath(originalPath);
    // `canonical === originalPath` means the canonical route already had its
    // chance and declined (wrong method, say). Replaying it would loop.
    if (!canonical || canonical === originalPath) return next();

    url.pathname = canonical;
    const forwarded = new Request(url.toString(), c.req.raw);
    stampCorrectedPath({ headers: forwarded.headers, originalPath });

    return otelApp.fetch(forwarded, appContextBindingsFor(c.app));
  });
}
