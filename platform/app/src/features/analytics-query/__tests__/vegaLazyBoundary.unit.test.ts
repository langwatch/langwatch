/**
 * Where Vega is allowed to be reached from.
 *
 * Vega, Vega-Lite, vega-embed and the generated schema validator are several
 * megabytes that only Chart mode needs, and one ordinary-looking static import
 * from the workbench is all it takes to put every byte of it in the entry
 * chunk — with nothing visibly wrong. The import graph is what the bundler
 * splits on, so it is the import graph that is pinned here.
 *
 * The claim is containment: within this feature, every module that reaches a
 * Vega package is reachable only through `GovernedSqlChartMode`, which is what
 * `LazyGovernedSqlChartMode` loads on demand and nothing imports directly.
 *
 * Node environment on purpose — this reads source, and evaluates none of it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `…/analytics-query/__tests__` → `…/analytics-query` */
const FEATURE_DIR = fileURLToPath(new URL("../", import.meta.url));

const LAZY_BOUNDARY = join(
  FEATURE_DIR,
  "components/LazyGovernedSqlChartMode.tsx",
);
const CHART_MODE = join(FEATURE_DIR, "components/GovernedSqlChartMode.tsx");

/** Packages whose presence in a chunk means the Vega runtime is in it. */
const VEGA_PACKAGE = /^(vega|vega-lite|vega-embed|react-vega)(\/|$)/;

/** The generated schema validator, which is megabytes of its own. */
const GENERATED_VALIDATOR = "vegaLiteSchemaValidator.generated";

const EXTENSIONS = [".ts", ".tsx", ".js"];

/** Static `import`/`export … from` specifiers. Deliberately not `import()`. */
const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)(?:[\s\S]*?)\sfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** `import type` and `export type` are erased before a bundler sees them. */
const TYPE_ONLY = /^\s*(?:import|export)\s+type\b/;

function specifiersOf(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(STATIC_IMPORT)) {
    const specifier = match[1] ?? match[2];
    if (specifier !== undefined && !TYPE_ONLY.test(match[0])) {
      found.push(specifier);
    }
  }
  return found;
}

function resolveLocal(specifier: string, fromFile: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
    // A `./x.js` specifier resolves to the TypeScript that emits it.
    base.replace(/\.js$/, ".ts"),
  ];
  return (
    candidates.find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null
  );
}

interface GraphWalk {
  readonly files: readonly string[];
  readonly packages: readonly string[];
}

/** Every local file and bare package reachable by static import from a root. */
function walkStaticGraph(root: string): GraphWalk {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [root];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file)) continue;
    files.add(file);

    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      const local = resolveLocal(specifier, file);
      if (local === null) {
        packages.add(specifier);
        continue;
      }
      queue.push(local);
    }
  }

  return { files: [...files], packages: [...packages] };
}

const reachesVega = ({ files, packages }: GraphWalk): boolean =>
  packages.some((name) => VEGA_PACKAGE.test(name)) ||
  files.some((file) => file.includes(GENERATED_VALIDATOR));

const featureSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" ? [] : featureSourceFiles(path);
    }
    // A declaration file is erased too, so it is never in a chunk.
    if (entry.name.endsWith(".d.ts")) return [];
    return EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ? [path]
      : [];
  });

describe("where the Vega runtime can be reached from", () => {
  describe("given the workbench's own modules", () => {
    describe("when their static import graphs are walked", () => {
      /** @scenario "Vega loads lazily from Chart mode only" */
      it("reaches Vega from chart mode, and from nothing that is not behind it", () => {
        const chartMode = walkStaticGraph(CHART_MODE);
        // Without this the containment claim below would hold vacuously — a
        // graph walk that finds nothing anywhere proves nothing.
        expect(reachesVega(chartMode)).toBe(true);

        const behindTheBoundary = new Set(chartMode.files);
        const leaks = featureSourceFiles(FEATURE_DIR)
          .filter((file) => !behindTheBoundary.has(file))
          .filter((file) => reachesVega(walkStaticGraph(file)));

        expect(leaks.map((file) => file.replace(FEATURE_DIR, ""))).toEqual([]);
      });

      /** @scenario "Vega loads lazily from Chart mode only" */
      it("keeps the lazy boundary itself free of everything it defers", () => {
        const boundary = walkStaticGraph(LAZY_BOUNDARY);

        expect(reachesVega(boundary)).toBe(false);
        expect(boundary.files).not.toContain(CHART_MODE);
        // It is a lazy import, and nothing else would defer anything.
        expect(readFileSync(LAZY_BOUNDARY, "utf8")).toContain(
          'import("./GovernedSqlChartMode")',
        );
      });
    });
  });
});
