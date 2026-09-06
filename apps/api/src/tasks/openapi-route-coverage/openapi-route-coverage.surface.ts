/**
 * The two lists the coverage audit compares, both read from the running
 * process rather than from its source tree.
 */

// Reading source was the monolith gate's own blind spot: a file with no
// declared basePath, a parameter carrying a Hono regex constraint, a family
// whose app nobody imported. Here the routes come from the policy registry
// every mount writes to, and the operations from describing that same app.

import { allRegisteredRoutes, documentedPathOf } from "../../app-rest/index.ts";
import { generateOpenApiDocument } from "../openapi-document/openapi-document.generator.ts";
import type { CoverageRoute } from "./openapi-route-coverage.auditor.ts";

/** What one read of the process's REST surface produced. */
export type CoverageSurface = Readonly<{
  /** Every route the composed application mounts. */
  routes: CoverageRoute[];
  /** `METHOD /path` for every operation the description produced. */
  documented: Set<string>;
  /** Where the description was written. */
  scratchPath: string;
}>;

/**
 * The document address a mounted route is published at. A family with a
 * `/api/v1` alias serves one route at two addresses and the document names the
 * canonical one (ADR 002 §1), so both collapse onto one key.
 */
export function documentAddressOf(route: {
  method: string;
  path: string;
  canonicalPath?: string;
}): string {
  // Upper-cased here rather than trusted from the caller: the policy registry
  // stores a method it has already normalised, and a mount report has not.
  return `${route.method.toUpperCase()} ${documentedPathOf(route.canonicalPath ?? route.path)}`;
}

/**
 * Composes the process's REST surface, describes it, and reports both sides.
 * The description goes to `scratchPath`, a build cache; the frozen document is
 * never touched, for the same reason the generator's own task does not.
 */
export async function readCoverageSurface({
  scratchPath,
}: {
  scratchPath: string;
}): Promise<CoverageSurface> {
  // Composing the surface is what populates the route registry, so the
  // description has to be produced BEFORE the registry is read.
  const generated = await generateOpenApiDocument({ outputPath: scratchPath });

  const documented = new Set(generated.operations);
  const describedPaths = new Set(
    generated.operations.map((operation) => operation.slice(operation.indexOf(" ") + 1)),
  );

  const routes = allRegisteredRoutes().map((route): CoverageRoute => {
    const key = documentAddressOf(route);
    return {
      key,
      family: route.family,
      pathDescribed: describedPaths.has(key.slice(key.indexOf(" ") + 1)),
      ...(route.withdrawn ? { withdrawn: true as const } : {}),
      ...(route.isNamespaceGuard ? { namespaceGuard: true as const } : {}),
    };
  });

  return { routes, documented, scratchPath };
}
