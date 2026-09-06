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
 * Vega package is reachable only *behind a lazy boundary* — a module some
 * `Lazy…` wrapper loads with a dynamic `import()` and nothing imports directly.
 *
 * There are two such boundaries, and they are two because the surfaces mount
 * different components, not because the chunk differs: the workbench mounts
 * `LangWatchQLChartMode`, the dashboard widget mounts
 * `LangWatchQLWidgetChart`. Both reach `LangWatchQLVegaLiteChart` and so both
 * reach Vega; what matters is that neither is reachable statically. Pinning
 * only the workbench's boundary would have let the dashboard's chart be
 * imported directly from the grid — several megabytes back in the entry chunk,
 * with nothing visibly wrong.
 *
 * Node environment on purpose — this reads source, and evaluates none of it.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `…/analytics-query/__tests__` → `…/analytics-query` */
const FEATURE_DIR = fileURLToPath(new URL("../", import.meta.url));

/** `…/analytics-query` → `…/src`, which the `~/` alias resolves from. */
const SRC_DIR = resolve(FEATURE_DIR, "../..");

/**
 * Every lazy boundary in this feature, as the wrapper that defers and the
 * module it defers to. Adding a third surface that draws a chart means adding
 * its pair here — a boundary omitted is a boundary this suite does not check.
 */
const LAZY_BOUNDARIES = [
  {
    wrapper: join(FEATURE_DIR, "components/LazyLangWatchQLChartMode.tsx"),
    deferred: join(FEATURE_DIR, "components/LangWatchQLChartMode.tsx"),
    specifier: 'import("./LangWatchQLChartMode")',
  },
  {
    wrapper: join(FEATURE_DIR, "components/LazyLangWatchQLWidgetChart.tsx"),
    deferred: join(FEATURE_DIR, "components/LangWatchQLWidgetChart.tsx"),
    specifier: 'import("./LangWatchQLWidgetChart")',
  },
] as const;

/** Packages whose presence in a chunk means the Vega runtime is in it. */
const VEGA_PACKAGE = /^(vega|vega-lite|vega-embed|react-vega)(\/|$)/;

/** The generated schema validator, which is megabytes of its own. */
const GENERATED_VALIDATOR = "vegaLiteSchemaValidator.generated";

const EXTENSIONS = [".ts", ".tsx", ".js"];

/**
 * Static `import`/`export … from` specifiers. Deliberately not `import()`.
 *
 * The clause between the keyword and `from` is bounded so one match cannot
 * span two statements. Unbounded (`[\s\S]*?`) it could, and the cost was not
 * a duplicate — it was a miss: `export type Foo = string;` followed by
 * `import vegaEmbed from "vega-embed"` matched as a single `export type …`
 * span, which `TYPE_ONLY` then discarded whole, taking the runtime import
 * with it. The scan reported no Vega in the chunk while Vega was statically
 * imported, which is the one direction this file must not fail in.
 *
 * So: no `;` inside the clause, and a newline only where the next line does
 * not begin a new `import`/`export`. Multi-line brace lists still match.
 */
const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)(?:[^;\n]|\n(?!\s*(?:import|export)\b))*?\sfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

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

function resolveLocal({
  specifier,
  fromFile,
}: {
  specifier: string;
  fromFile: string;
}): string | null {
  const base = specifier.startsWith("~/")
    ? join(SRC_DIR, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(fromFile), specifier)
      : null;
  if (base === null) return null;

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
      const local = resolveLocal({ specifier, fromFile: file });
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
      it("reaches Vega from each deferred module, and from nothing that is not behind one", () => {
        const behindABoundary = new Set<string>();
        for (const { deferred } of LAZY_BOUNDARIES) {
          const walk = walkStaticGraph(deferred);
          // Without this the containment claim below would hold vacuously — a
          // graph walk that finds nothing anywhere proves nothing.
          expect(reachesVega(walk)).toBe(true);
          for (const file of walk.files) behindABoundary.add(file);
        }

        const leaks = featureSourceFiles(FEATURE_DIR)
          .filter((file) => !behindABoundary.has(file))
          .filter((file) => reachesVega(walkStaticGraph(file)));

        expect(leaks.map((file) => file.replace(FEATURE_DIR, ""))).toEqual([]);
      });

      /** @scenario "Each lazy Vega wrapper defers its own module, in Chart mode and on the dashboard widget" */
      it.each(
        LAZY_BOUNDARIES.map((boundary) => [boundary.wrapper, boundary]),
      )("keeps %s free of everything it defers", (_name, {
        wrapper,
        deferred,
        specifier,
      }) => {
        const walk = walkStaticGraph(wrapper);

        expect(reachesVega(walk)).toBe(false);
        expect(walk.files).not.toContain(deferred);
        // It is a lazy import, and nothing else would defer anything.
        expect(readFileSync(wrapper, "utf8")).toContain(specifier);
      });
    });
  });

  /**
   * The scan above is only as good as what it can see, and its own failure
   * direction is silent: a specifier it never records is a leak it reports as
   * clean. These read the reader.
   */
  describe("given a source whose imports follow a type-only statement", () => {
    describe("when its specifiers are collected", () => {
      it("records the runtime import that the type-only line precedes", () => {
        expect(
          specifiersOf(
            'export type Foo = string;\nimport vegaEmbed from "vega-embed";\n',
          ),
        ).toEqual(["vega-embed"]);
      });

      it("records it even where no semicolon closes the type-only line", () => {
        expect(
          specifiersOf(
            'export type Foo = string\nimport vegaEmbed from "vega-embed"\n',
          ),
        ).toEqual(["vega-embed"]);
      });

      it("still discards a type-only import, which no bundler emits", () => {
        expect(specifiersOf('import type { X } from "vega";\n')).toEqual([]);
      });

      it("still reads a specifier across a multi-line brace list", () => {
        expect(
          specifiersOf('import {\n  a,\n  b,\n} from "vega-lite";\n'),
        ).toEqual(["vega-lite"]);
      });
    });
  });
});
