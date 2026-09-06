/**
 * Serves the OTLP paths a misconfigured exporter produces from the canonical
 * handlers in `./otlp-ingest.api`.
 *
 * Not a redirect. An OTLP exporter is not a browser and the two largest client
 * stacks will not follow one: OkHttp, under the Java exporter, refuses to
 * replay a POST across 307/308, and the Node exporter issues its request
 * through `http.request` with no redirect handling at all. A redirect would
 * repair part of the fleet and go on silently dropping the rest, so the request
 * is replayed internally instead.
 *
 * MOUNT ORDER: this app must be registered AFTER the canonical OTLP family and
 * after the collector, so their own routes match first. The wildcards below are
 * broad on purpose — the decision lives in `canonicalOtlpPath`, which is an
 * allow-list — and anything they catch that is not a known misconfiguration is
 * DECLINED, so a namespace mounted after this one keeps its own routing and its
 * own 404.
 *
 * The family declares `publicEndpoint` because it TERMINATES NOTHING: it
 * rewrites the path and hands the request to the canonical route, which
 * authenticates it exactly as it would any other — a corrected path is refused
 * for want of credentials the same way the canonical one is, and the spec pins
 * that.
 *
 * See specs/otlp/endpoint-path-canonicalisation.feature.
 */
import {
  type AppRestSecurity,
  declined,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
} from "@langwatch/api/rest";
import { publicEndpoint } from "@langwatch/api";
import { canonicalOtlpPath, stampCorrectedPath } from "@langwatch/otlp";
import type { Context } from "hono";

/**
 * Every namespace a recognised misconfiguration can land in.
 *
 * `/v1/*` is only reachable because the process routes root-level OTLP paths
 * into the API — left to the SPA fallback it answered with the HTML shell and a
 * 200, which an exporter reads as success before dropping the batch.
 */
const CANDIDATE_PATTERNS = ["/api/otel/*", "/api/collector/*", "/api/v1/*", "/v1/*"];

const NO_CREDENTIAL_REASON =
  "the alias terminates nothing: the canonical route it forwards to authenticates the request";

/**
 * Builds the re-dispatcher over the canonical OTLP app.
 *
 * The canonical app is a parameter rather than an import so the two cannot be
 * mounted out of step: a process that composed no OTLP family has nothing to
 * pass here and therefore mounts no aliases either, which is the correct
 * outcome — an alias forwarding into a family nobody built would answer 404
 * from a route that looks like it exists.
 */
export function createOtlpPathAliasRestApp(options: {
  security: AppRestSecurity;
  canonical: MountableRestApp;
}): MountableRestApp {
  const { security, canonical } = options;

  const { service, policy } = security.createServiceVersionedApp({
    name: "otlp-path-alias",
    // The literal paths an exporter produces, mounted where they are written:
    // this family owns no namespace of its own and publishes no version.
    basePath: "/",
    bareMount: true,
    errorEnvelope: "canonical",
  });

  const forward = async (c: Context) => {
    const url = new URL(c.req.url);
    const originalPath = url.pathname;

    const corrected = canonicalOtlpPath(originalPath);
    // `corrected === originalPath` means the canonical route already had its
    // chance and declined (wrong method, say). Replaying it would loop.
    if (!corrected || corrected === originalPath) return declined();

    url.pathname = corrected;
    const forwarded = new Request(url.toString(), c.req.raw);
    stampCorrectedPath({ headers: forwarded.headers, originalPath });

    return canonical.fetch(forwarded, c.env);
  };

  return CANDIDATE_PATTERNS.reduce(
    (built, pattern) =>
      built.registerAnyMethodRoute(pattern, MANAGEMENT_API_VERSION, forward, (b) =>
        policy(publicEndpoint(NO_CREDENTIAL_REASON))(b),
      ),
    service,
  ).build() as MountableRestApp;
}
