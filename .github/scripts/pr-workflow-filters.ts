// Builds pr.yml's one path filter: a key per called workflow, holding every
// path that workflow's own detect-changes step consults, so the two never
// drift. Spec: specs/ci/one-pull-request-workflow.feature
// Usage: node --experimental-strip-types .github/scripts/pr-workflow-filters.ts <out.yml>

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { gateFilters } from "./guard-path-filters.ts";

/** pr.yml's job key for each workflow it calls. */
export const CALLED: Record<string, string> = {
  app: "langwatch-app-ci.yml",
  e2e: "e2e-ci.yml",
  nlp: "langwatch-nlp-ci.yml",
  langevals: "langevals-ci.yml",
  mcp: "mcp-javascript-ci.yml",
  "sdk-go": "sdk-go-ci.yml",
  "sdk-javascript": "sdk-javascript-ci.yml",
  docs: "docs-ci.yml",
  codeql: "codeql.yml",
  "clickhouse-serverless": "clickhouse-serverless.yml",
};

/** A change to how pr.yml decides starts every workflow it calls. */
export const ALWAYS = [".github/workflows/pr.yml", ".github/scripts/pr-workflow-filters.ts"];

/** The paths one workflow's detect-changes steps consult, plus ALWAYS. */
export const pathsOf = (source: string, file: string): string[] => {
  const result = gateFilters(source, true);
  if (result.kind !== "filtered") {
    throw new Error(`${file}: no readable detect-changes filter (${result.kind})`);
  }
  return [...new Set([...result.entries, ...ALWAYS])];
};

/** The dorny/paths-filter block: one key per called workflow. */
export const buildFilters = (readWorkflow: (file: string) => string): string =>
  Object.entries(CALLED)
    .map(([key, file]) => {
      const entries = pathsOf(readWorkflow(file), file).map((path) => `  - '${path}'`);
      return `${key}:\n${entries.join("\n")}`;
    })
    .join("\n");

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: pr-workflow-filters.ts <out.yml>");
  const dir = join(import.meta.dirname, "..", "workflows");
  writeFileSync(out, buildFilters((file) => readFileSync(join(dir, file), "utf8")) + "\n");
}
