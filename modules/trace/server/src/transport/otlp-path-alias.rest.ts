/**
 * Serves the OTLP paths a misconfigured exporter produces, replayed internally
 * (not redirected) into the canonical handlers `./otlp-ingest.rest.ts`
 * declares. Must mount AFTER the canonical OTLP family: the mount file wires
 * this family's `app.canonical` to that family's own mounted
 * `MountableRestApp`. Declares `public` access since it terminates nothing -
 * the canonical route it forwards to authenticates the request. See
 * `specs/otlp/endpoint-path-canonicalisation.feature`.
 */
import {
  declined,
  defineRestRouter,
  MANAGEMENT_API_VERSION,
  type MountableRestApp,
  type RestRawResult,
} from "@langwatch/api/rest";
import { canonicalOtlpPath, stampCorrectedPath } from "@langwatch/otlp";
import { moduleApi } from "@langwatch/runtime-composition";

/**
 * The canonical family this alias forwards into, supplied at mount time so
 * the two cannot be wired out of step: a process that composed no OTLP
 * family mounts no aliases either.
 */
export interface OtlpPathAliasApp {
  canonical: MountableRestApp;
}

export const OtlpPathAliasApi = moduleApi<OtlpPathAliasApp>("trace");

/**
 * Every namespace a recognised misconfiguration can land in. `/v1/*` is only
 * reachable because the process routes root-level OTLP paths into the API -
 * left to the SPA fallback, an exporter would read the HTML shell's 200 as
 * success before dropping the batch.
 */
const CANDIDATE_PATHS = ["/api/otel/*", "/api/collector/*", "/api/v1/*", "/v1/*"] as const;

const NO_CREDENTIAL_REASON =
  "the alias terminates nothing: the canonical route it forwards to authenticates the request";

async function forward(app: OtlpPathAliasApp, request: Request): Promise<RestRawResult> {
  const url = new URL(request.url);
  const originalPath = url.pathname;

  const corrected = canonicalOtlpPath(originalPath);
  // `corrected === originalPath` means the canonical route already had its
  // chance and declined (wrong method, say). Replaying it would loop.
  if (!corrected || corrected === originalPath) {
    return declined();
  }

  url.pathname = corrected;
  const forwarded = new Request(url.toString(), request);
  stampCorrectedPath({ headers: forwarded.headers, originalPath });

  return app.canonical.fetch(forwarded);
}

const router = defineRestRouter(OtlpPathAliasApi)
  .withNamespace("otlp-path-alias")
  .withVersion(MANAGEMENT_API_VERSION)
  .withAddressing("literal", { v1Twin: false });

export const otlpPathAliasRest = CANDIDATE_PATHS.reduce(
  (built, path) =>
    built
      .get(path, `otlpPathAlias${path.replace(/[/*]/g, "_")}`)
      .anyMethod()
      .withAccess({ kind: "public", reason: NO_CREDENTIAL_REASON })
      .withRawResponse({ produces: "application/json" })
      .withDocs({ hide: true })
      .handle(({ app, request }) => forward(app, request)),
  router,
).build();
