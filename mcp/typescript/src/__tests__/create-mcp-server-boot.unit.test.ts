/**
 * The boot graph of the published `langwatch-mcp-server` binary.
 *
 * specs/mcp-server/boot-graph-stays-lazy.feature
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const SERVER_SRC = resolve(__dirname, "..");
const ENTRY = resolve(SERVER_SRC, "create-mcp-server.ts");

/**
 * The handlers on the boot path today, of about a hundred; the rest load via `await import(...)`.
 * Adding one here pays for it at every `npx` start, so do it deliberately.
 */
const EAGER_HANDLERS = new Set([
  "tools/get-experiment-results.ts",
  "tools/list-experiment-runs.ts",
  "tools/list-experiments.ts",
  "tools/run-experiment.ts",
  "tools/test-agent.ts",
  "tools/update-test-suite.ts",
  "tools/experiment-run-status.ts",
  "tools/format-suite-details.ts",
]);

const STATIC_IMPORT = /^\s*import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm;
const STATIC_REEXPORT = /^\s*export\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/gm;

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const re of [STATIC_IMPORT, STATIC_REEXPORT]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) found.push(match[1]!);
  }
  return found;
}

/**
 * Relative specifiers only: a bare one is a package, and what a dependency
 * costs to evaluate is not this file's question.
 */
function resolveRelative(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier).replace(/\.[cm]?js$/, "");
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, base]) {
    if (existsSync(candidate) && !candidate.endsWith("/")) return candidate;
  }
  return null;
}

/** Every file Node evaluates before `createMcpServer` can be called. */
function bootGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      const target = resolveRelative(specifier, file);
      if (target !== null) queue.push(target);
    }
  }
  return seen;
}

describe("createMcpServer's module graph", () => {
  const graph = bootGraph(ENTRY);
  const withinServer = [...graph].map((file) => relative(SERVER_SRC, file));

  describe("given the module that creates the server", () => {
    it("reaches something at all, so an empty graph cannot pass by accident", () => {
      expect(graph.size).toBeGreaterThan(5);
      expect(graph).toContain(ENTRY);
    });

    /** @scenario "The generated evaluator catalogue is not on the boot path" */
    it("leaves the generated evaluator catalogue off the boot path", () => {
      const generated = [...graph].filter((file) => file.includes("evaluators.generated"));

      expect(generated).toEqual([]);
    });

    /** @scenario "Tool handlers are not imported at the top of the registration module" */
    it("carries only the handlers it registers eagerly", () => {
      const handlers = withinServer.filter((file) => file.startsWith("tools/"));

      expect(new Set(handlers)).toEqual(EAGER_HANDLERS);
    });
  });

  describe("when a lazily reached handler is rewritten as a top-level import", () => {
    /** @scenario "A handler moved onto the boot path is reported" */
    it("appears in the boot graph, which is what this check reports", () => {
      const lazy = resolve(SERVER_SRC, "tools/report-issue.ts");
      const rewritten = bootGraph(ENTRY);
      rewritten.add(lazy);

      const handlers = [...rewritten]
        .map((file) => relative(SERVER_SRC, file))
        .filter((file) => file.startsWith("tools/"));

      expect(new Set(handlers)).not.toEqual(EAGER_HANDLERS);
      expect(handlers).toContain("tools/report-issue.ts");
    });
  });
});
