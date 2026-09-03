import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalOtlpPath } from "@langwatch/otlp";
import type { PublicAppConfig } from "@langwatch/ui/public-config";
import { resolvePublicAppConfig } from "@langwatch/ui/public-config/projection";
import { ApiRawRequestSurfacePort } from "../api-http.listener";
import { isRootDiscoveryPath } from "../features/discovery/discovery-locations";
import { assetBaseOrigin, normalizeAssetBase } from "./app-static.asset-base";
import { serveStaticOrFallback } from "./app-static.handler";
import { buildSecurityHeaders } from "./app-static.security-headers";

/**
 * The built browser bundle, served by the API process.
 *
 * ONE image serves both halves. `apps/ui` is a Vite build, not a process: it
 * emits `dist/client` and nothing runs it. The Helm chart has one Deployment
 * for the interactive tier and no static one, so the pod that answers `/api/*`
 * is also the pod a browser asks for `/`. Standing up a second Deployment to
 * serve files would give a rolling deploy two independent rollouts of one
 * artifact, and a browser could then load the shell from the new one and its
 * chunks from the old.
 *
 * It is a raw surface rather than a Hono route for the same reason the hosted
 * MCP endpoint is: the handler streams files straight off disk into the Node
 * response. Unlike MCP, this one is a FALLBACK, so its `handles` predicate is
 * a complement — everything the API has claimed is refused here and reaches
 * Hono untouched. The refusals are exact rather than a `/api/` prefix test:
 *
 * - `/api/*` — every REST, tRPC and SSE family, plus `/api/health`.
 * - `/metrics` — the process's own scrape endpoint.
 * - the canonical and misconfigured OTLP paths (`/v1/traces` and friends).
 *   An exporter handed the site root posts there, and the SPA fallback would
 *   answer the HTML shell with a 200, which the exporter reads as success
 *   before dropping the batch.
 * - `/.well-known/openapi` and `/llms.txt`. Root-level by convention, which is
 *   the point of them; a discovery URL that returns HTML and calls it success
 *   is worse than one that 404s.
 *
 * Both lists are imported from the modules that own them rather than restated,
 * so a path added to the API cannot start being answered with the SPA shell.
 */
export class ApiStaticSurface extends ApiRawRequestSurfacePort {
  private constructor(
    private readonly clientDistDir: string,
    private readonly publicConfig: PublicAppConfig,
    private readonly securityHeaders: Record<string, string>,
  ) {
    super();
  }

  static create(options: {
    clientDistDir: string;
    publicConfig: PublicAppConfig;
    /**
     * Applied to every response this surface writes, including the 404. The
     * browser reads the Content-Security-Policy off the document that loads
     * the bundle, so it belongs on the surface that serves the document
     * rather than on the API families Hono answers.
     */
    securityHeaders?: Record<string, string>;
  }): ApiStaticSurface {
    return new ApiStaticSurface(
      options.clientDistDir,
      options.publicConfig,
      options.securityHeaders ?? {},
    );
  }

  handles(pathname: string): boolean {
    return !pathIsClaimedByTheApi(pathname);
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    // Collapse runs of slashes so `//authorize` resolves to `/authorize`
    // rather than failing the absolute-path guard on the SPA fallback.
    const pathname = normalizePathname(request.url ?? "/");
    for (const [name, value] of Object.entries(this.securityHeaders)) {
      response.setHeader(name, value);
    }
    const handled = serveStaticOrFallback({
      res: response,
      pathname,
      clientDistDir: this.clientDistDir,
      publicConfig: this.publicConfig,
    });
    if (handled) return;

    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain");
    response.end("Not Found");
  }
}

/** The pathname a request names, without its query and with slash runs collapsed. */
export function normalizePathname(url: string): string {
  return (url.split("?")[0] ?? "/").replace(/\/{2,}/g, "/");
}

/**
 * True when the API serves this path, so the SPA fallback must not.
 *
 * Exported for the test that pins the complement: every claimed shape refused,
 * every browser route accepted.
 */
export function pathIsClaimedByTheApi(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname === "/metrics") return true;
  if (canonicalOtlpPath(pathname) !== null) return true;
  return isRootDiscoveryPath(pathname);
}

/**
 * Where the built browser bundle sits relative to this module.
 *
 * `apps/ui` builds to `apps/ui/dist/client`, and the image copies both apps
 * side by side under `/app/apps`, so the artifact is a fixed relative walk from
 * `apps/api/src/app-static/`. `LANGWATCH_UI_DIST_DIR` overrides it for a
 * deployment that stages the bundle somewhere else.
 */
export function resolveClientDistDir(
  source: { LANGWATCH_UI_DIST_DIR?: string | undefined } = process.env,
): string {
  const configured = source.LANGWATCH_UI_DIST_DIR?.trim();
  if (configured) return path.resolve(configured);
  return fileURLToPath(new URL("../../../ui/dist/client", import.meta.url));
}

/**
 * The static surface, or `undefined` when this process has no bundle to serve.
 *
 * Absence is the correct answer in development — `apps/ui` runs its own Vite
 * server there and proxies `/api/*` here — and it is announced rather than
 * assumed: a production image whose `apps/ui` build did not land would
 * otherwise answer every browser route with the API's 404 and look like a
 * routing bug rather than a missing artifact.
 */
export function tryCreateApiStaticSurface(options: {
  environment?: NodeJS.ProcessEnv;
  report: (message: string, context: { clientDistDir: string }) => void;
}): ApiStaticSurface | undefined {
  const environment = options.environment ?? process.env;
  const clientDistDir = resolveClientDistDir(environment);

  if (!fs.existsSync(path.join(clientDistDir, "index.html"))) {
    options.report(
      "API serves no browser bundle: no index.html under the resolved apps/ui build output. " +
        "Set LANGWATCH_UI_DIST_DIR, or run the apps/ui build.",
      { clientDistDir },
    );
    return undefined;
  }

  return ApiStaticSurface.create({
    clientDistDir,
    securityHeaders: buildSecurityHeaders({
      dev: environment.NODE_ENV !== "production",
      environment,
      assetOrigin: assetBaseOrigin(normalizeAssetBase(environment.LANGWATCH_ASSET_BASE)),
    }),
    publicConfig: resolvePublicAppConfig(environment),
  });
}

/**
 * Serves several raw surfaces from the one hook the listener offers.
 *
 * Order is the contract: the specific surfaces are asked first and the SPA
 * fallback, which claims everything left, is asked last. A composite rather
 * than a second listener hook because "which surface answers this path" is one
 * decision, and splitting it across two places is how a fallback ends up ahead
 * of the endpoint it was meant to fall back from.
 */
export class CompositeApiRawSurface extends ApiRawRequestSurfacePort {
  private constructor(private readonly surfaces: readonly ApiRawRequestSurfacePort[]) {
    super();
  }

  /** `undefined` when nothing was supplied, so the listener stays on its plain path. */
  static of(
    surfaces: readonly (ApiRawRequestSurfacePort | undefined)[],
  ): ApiRawRequestSurfacePort | undefined {
    const present = surfaces.filter(
      (surface): surface is ApiRawRequestSurfacePort => surface !== undefined,
    );
    if (present.length === 0) return undefined;
    if (present.length === 1) return present[0];
    return new CompositeApiRawSurface(present);
  }

  handles(pathname: string): boolean {
    return this.surfaces.some((surface) => surface.handles(pathname));
  }

  handle(request: IncomingMessage, response: ServerResponse): void {
    const pathname = normalizePathname(request.url ?? "/");
    for (const surface of this.surfaces) {
      if (surface.handles(pathname)) {
        surface.handle(request, response);
        return;
      }
    }
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain");
    response.end("Not Found");
  }
}
