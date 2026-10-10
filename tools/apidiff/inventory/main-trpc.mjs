// Written into a main worktree's platform/app by apidiff and deleted after it
// runs: imports the monolith's appRouter and prints its procedure manifest.
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { zodToJsonSchema } from "zod-to-json-schema";

import { appRouter } from "./src/server/api/root.ts";

const [outFile] = process.argv.slice(2);
const appDir = process.cwd();
const repoRoot = resolve(appDir, "../..");
const rootFile = join(appDir, "src/server/api/root.ts");

function sourceFor(specifier) {
  if (specifier.startsWith("@ee/")) return join(appDir, "ee", specifier.slice(4));
  if (specifier.startsWith("~/")) return join(appDir, "src", specifier.slice(2));
  return resolve(appDir, "src/server/api", specifier);
}

function routerSources() {
  const text = readFileSync(rootFile, "utf8");
  const imports = new Map();
  for (const match of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*"([^"]+)"/g)) {
    for (const name of match[1].split(",")) {
      const local = name
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (local) imports.set(local, match[2]);
    }
  }
  const sources = new Map();
  for (const match of text.matchAll(/^\s*([A-Za-z0-9_]+):\s*([A-Za-z0-9_]+),?\s*$/gm)) {
    const specifier = imports.get(match[2]);
    if (specifier) sources.set(match[1], relative(repoRoot, sourceFor(specifier)) + ".ts");
  }
  return sources;
}

function toJsonSchema(schema) {
  if (!schema || typeof schema !== "object") return null;
  if ("_zod" in schema) return { unconverted: "zod v4 schema on a zod v3 side" };
  try {
    return zodToJsonSchema(schema, { target: "jsonSchema7", $refStrategy: "none" });
  } catch (error) {
    return { unconverted: String(error && error.message) };
  }
}

function inputSchema(definition) {
  const inputs = (definition.inputs ?? []).map(toJsonSchema).filter(Boolean);
  if (inputs.length === 0) return null;
  if (inputs.length === 1) return inputs[0];
  return { allOf: inputs };
}

function flatten(record, prefix, into) {
  for (const [key, value] of Object.entries(record ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && value._def && value._def.procedure) into.set(path, value);
    else if (value && value._def && value._def.record) flatten(value._def.record, path, into);
    else if (value && typeof value === "object" && !value._def) flatten(value, path, into);
  }
  return into;
}

const sources = routerSources();
const procedures = [];
for (const [path, procedure] of flatten(appRouter._def.record, "", new Map())) {
  const definition = procedure._def;
  procedures.push({
    path,
    kind: definition.type,
    input: inputSchema(definition),
    output: definition.output ? toJsonSchema(definition.output) : null,
    source: sources.get(path.split(".")[0]) ?? relative(repoRoot, rootFile),
  });
}
const sorted = procedures.toSorted((left, right) => left.path.localeCompare(right.path));
writeFileSync(outFile, JSON.stringify({ side: "main", procedures: sorted }, null, 2));
process.exit(0);
