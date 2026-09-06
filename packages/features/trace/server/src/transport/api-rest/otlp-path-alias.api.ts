/**
 * Serves the OTLP paths a misconfigured exporter produces, replayed internally (not redirected)
 * into the canonical handlers in `./otlp-ingest.api`. Must mount AFTER the canonical OTLP family
 * and the collector. Declares `publicEndpoint` since it terminates nothing — the canonical route
 * it forwards to authenticates the request. See specs/otlp/endpoint-path-canonicalisation.feature.
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
 * Every namespace a recognised misconfiguration can land in. `/v1/*` is only reachable because
 * the process routes root-level OTLP paths into the API — left to the SPA fallback, an exporter
 * would read the HTML shell's 200 as success before dropping the batch.
 */
const CANDIDATE_PATTERNS = ["/api/otel/*", "/api/collector/*", "/api/v1/*", "/v1/*"];

const NO_CREDENTIAL_REASON =
  "the alias terminates nothing: the canonical route it forwards to authenticates the request";

/**
 * The canonical app is a parameter rather than an import so the two cannot be mounted out of
 * step: a process that composed no OTLP family mounts no aliases either.
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
