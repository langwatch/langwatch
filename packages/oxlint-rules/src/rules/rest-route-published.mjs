import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { memberName } from "./zod-schema-origin.mjs";

// The wire main publishes: route parameter names already in it stay as they are
// (Alex, 2026-09-23). Addresses mirror basePathOf/canonicalV1Path in
// packages/api/src/rest/addressing.ts.

export const PUBLISHED_WIRE = "docs/api-reference/openapiLangWatch.json";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const COLON_PARAM = /:([A-Za-z0-9_]+)(?:\{[^}]*\})?/g;
const VERSION_SEGMENT = /^v\d+$/;
const V1_PREFIX = "/api/v1";

const publishedCache = new Map();

function readPublished(cwd) {
  const file = join(cwd, PUBLISHED_WIRE);
  if (!existsSync(file)) {
    throw new Error(
      `langwatch/rest-route reads the published wire from \`${PUBLISHED_WIRE}\`, which is missing under ${cwd}. Restore it from origin/main: without it every existing route's path parameters read as new.`,
    );
  }

  const operations = new Set();
  for (const [path, item] of Object.entries(JSON.parse(readFileSync(file, "utf8")).paths ?? {})) {
    for (const method of Object.keys(item ?? {})) {
      if (HTTP_METHODS.has(method)) operations.add(`${method.toUpperCase()} ${path}`);
    }
  }

  return operations;
}

/** Every `METHOD /path` the published document lists, read once per workspace root. */
function publishedOperations(cwd) {
  const cached = publishedCache.get(cwd);
  if (cached) return cached;

  const operations = readPublished(cwd);
  publishedCache.set(cwd, operations);

  return operations;
}

function literalOf(node) {
  return node?.type === "Literal" ? node.value : void 0;
}

function optionsOf(node) {
  const options = {};
  if (node?.type !== "ObjectExpression") return options;

  for (const property of node.properties) {
    if (property.type !== "Property" || property.key.type !== "Identifier") continue;
    options[property.key.name] = literalOf(property.value);
  }

  return options;
}

function successorOf(node) {
  if (node?.type !== "ObjectExpression") return void 0;

  return node.properties.find(
    (property) => property.type === "Property" && property.key.name === "successor",
  )?.value;
}

/** The router's namespace and addressing, read from the chain beneath a route's opener. */
export function familyOf(opener) {
  const family = { addressing: "dated", options: {} };
  let current = opener.callee.object;

  while (current?.type === "CallExpression" && current.callee.type === "MemberExpression") {
    const name = memberName(current.callee);
    if (name === "withNamespace") family.namespace = literalOf(current.arguments[0]);
    if (name === "withDeprecated") family.successor = successorOf(current.arguments[0]);
    if (name === "withAddressing") {
      family.addressing = literalOf(current.arguments[0]);
      family.options = optionsOf(current.arguments[1]);
    }
    current = current.callee.object;
  }

  return family;
}

function canonicalV1Path(path) {
  if (!path.startsWith("/api/")) return void 0;
  const rest = path.slice("/api".length);
  const versioned = rest.split("/").some((segment) => VERSION_SEGMENT.test(segment));

  return versioned ? void 0 : `${V1_PREFIX}${rest}`;
}

function basePathOf({ addressing, namespace, options }) {
  if (addressing === "literal") return "";
  if (typeof namespace !== "string") return void 0;
  if (addressing === "v1-only") return `${V1_PREFIX}/${namespace}`;
  if (addressing === "v1-in-path") return `/api/${namespace}/${options.generation ?? "v1"}`;

  return addressing === "dated" ? `/api/${namespace}` : void 0;
}

function addressesOf(path, family) {
  const base = basePathOf(family);
  if (base === void 0) return [];

  const address = path === "/" && base ? base : `${base}${path}`;
  const twinless = family.addressing === "v1-only" || family.addressing === "v1-in-path";
  const twin = twinless || family.options.v1Twin === false ? void 0 : canonicalV1Path(address);

  return [address, twin].filter(Boolean);
}

/** Whether main publishes this route, or the successor a deprecated alias serves. */
export function isPublishedRoute({ cwd, method, path, family, successor }) {
  const published = publishedOperations(cwd);
  const aliased = successor ? [`${successor}${path === "/" ? "" : path}`] : [];

  return [...addressesOf(path, family), ...aliased].some((address) =>
    published.has(`${method.toUpperCase()} ${address.replace(COLON_PARAM, "{$1}")}`),
  );
}
