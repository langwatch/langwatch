// Written into a branch worktree's packages/api by apidiff and deleted after
// it runs: prints every route the api process serves, from the installed
// server modules' REST and socket declarations, the API application's own
// lanes (tRPC, SSE, the OpenAPI document) and the health door.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Hono } from "hono";
import { findTargetHandler, isMiddleware } from "hono/utils/handler";
import { mergePath } from "hono/utils/url";

import { composeApiApplication } from "../process/src/transport/api-surface.ts";
import { addressesOf, basePathOf, canonicalV1Path } from "./src/rest/addressing.ts";

const [outFile, repoRoot] = process.argv.slice(2);
const routes = new Map();
const failures = [];

function serve(method, path, source) {
  const key = `${method} ${path}`;
  if (!routes.has(key)) routes.set(key, { method, path, source });
}

function restAddresses(declaration, route) {
  const base = basePathOf(declaration);
  return addressesOf({ route, declaration }).flatMap((mount) => {
    const absolute = base === "" ? mount.path : mergePath(base, mount.path);
    const alias = declaration.v1Twin ? canonicalV1Path(absolute) : null;
    return alias ? [absolute, alias] : [absolute];
  });
}

function serveRest(declaration, source) {
  for (const route of declaration.routes) {
    const methods = route.anyMethod ? ["all"] : (route.methods ?? [route.method]);
    for (const path of restAddresses(declaration, route)) {
      for (const method of methods) serve(method.toUpperCase(), path, source);
    }
  }
}

function serveDescriptor(descriptor, source) {
  if (descriptor.protocol === "rest") serveRest(descriptor.router(), source);
  if (descriptor.protocol === "websocket") {
    const socket = descriptor.router();
    if (typeof socket.path === "string") serve("GET", socket.path, source);
  }
}

const installed = join(
  repoRoot,
  "apps/api/src/process-modules.generated.ts",
);
const { processModules } = await import(pathToFileURL(installed).href);
for (const module of processModules) {
  const source = `module ${module.name}`;
  for (const descriptor of module.transports ?? []) {
    try {
      serveDescriptor(descriptor, source);
    } catch (error) {
      failures.push({ source, error: String(error && error.message) });
    }
  }
}

const lanes = composeApiApplication({ rest: { app: new Hono() }, trpc: {} });
for (const route of lanes.routes) {
  const handler = findTargetHandler(route.handler);
  if (isMiddleware(handler) || route.path === "/*" || route.path === "*") continue;
  serve(route.method, route.path, "packages/process/src/transport/api-surface.ts");
}

const healthFile = join(repoRoot, "apps/api/src/api-health-route.ts");
if (existsSync(healthFile)) {
  const { apiHealthRoute } = await import(pathToFileURL(healthFile).href);
  serve("ALL", apiHealthRoute.path, "apps/api/src/api-health-route.ts");
}

const sorted = [...routes.values()].toSorted(
  (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
);
writeFileSync(outFile, JSON.stringify({ side: "branch", routes: sorted, failures }, null, 2));
process.exit(0);
