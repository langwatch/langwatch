// Written into a main worktree's platform/app by apidiff and deleted after it
// runs: builds the monolith's Hono API router and prints every route it serves,
// documented or not. Middleware is told apart the way hono/dev does.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { findTargetHandler, isMiddleware } from "hono/utils/handler";

import { createApiRouter } from "./src/server/api-router.ts";

const [outFile] = process.argv.slice(2);
const appDir = process.cwd();
const repoRoot = resolve(appDir, "../..");
const routerDir = join(appDir, "src/server");
const routerFile = join(routerDir, "api-router.ts");

function modulePathFor(specifier) {
  if (specifier.startsWith("@ee/")) return join(appDir, "ee", specifier.slice(4));
  if (specifier.startsWith("~/")) return join(appDir, "src", specifier.slice(2));
  return resolve(routerDir, specifier);
}

function importedSpecifiers() {
  const text = readFileSync(routerFile, "utf8");
  return [...text.matchAll(/import\s*\{[^}]*\}\s*from\s*"([^"]+)"/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier !== "hono");
}

async function handlerSources() {
  const sources = new Map();
  for (const specifier of importedSpecifiers()) {
    const path = modulePathFor(specifier);
    const exported = await import(path);
    for (const value of Object.values(exported)) {
      if (!value || !Array.isArray(value.routes)) continue;
      for (const route of value.routes) {
        const handler = findTargetHandler(route.handler);
        if (!sources.has(handler)) sources.set(handler, relative(repoRoot, path));
      }
    }
  }
  return sources;
}

const sources = await handlerSources();
const served = new Map();
for (const route of createApiRouter().routes) {
  const handler = findTargetHandler(route.handler);
  if (isMiddleware(handler)) continue;
  const key = `${route.method} ${route.path}`;
  if (served.has(key)) continue;
  served.set(key, {
    method: route.method,
    path: route.path,
    source: sources.get(handler) ?? relative(repoRoot, routerFile),
  });
}
const routes = [...served.values()].toSorted(
  (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
);
writeFileSync(outFile, JSON.stringify({ side: "main", routes }, null, 2));
process.exit(0);
