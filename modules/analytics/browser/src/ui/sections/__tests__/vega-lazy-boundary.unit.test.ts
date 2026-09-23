/**
 * Where Vega is allowed to be reached from: Vega, Vega-Lite, vega-embed
 * and the schema validator are megabytes only a chart surface needs. Every
 * module reaching one must sit behind a lazy `import()`, never imported directly.
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
 * Static `import`/`export … from` specifiers, deliberately not `import()`.
 * The clause is bounded so one match can't span two statements — unbounded,
 * a type-only export before a Vega import could hide it undetected.
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
  let base: string;
  if (specifier.startsWith("~/")) {
    base = join(SRC_DIR, specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = resolve(dirname(fromFile), specifier);
  } else {
    return null;
  }

  const candidates = [
    base,
    ...EXTENSIONS.map((extension) => `${base}${extension}`),
    ...EXTENSIONS.map((extension) => join(base, `index${extension}`)),
    // A `./x.js` specifier resolves to the TypeScript that emits it.
    base.replace(/\.js$/, ".ts"),
  ];
  return (
    candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null
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
    return EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });

describe("where the Vega runtime can be reached from", () => {
  describe("given this feature's own modules", () => {
    describe("when their static import graphs are walked", () => {
      /** @scenario "Vega loads lazily from the dashboard widget only" */
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

      /** @scenario "The lazy Vega wrapper defers its own module, on the dashboard widget" */
      it.each(LAZY_BOUNDARIES.map((boundary) => [boundary.wrapper, boundary]))(
        "keeps %s free of everything it defers",
        (_name, { wrapper, deferred, specifier }) => {
          const walk = walkStaticGraph(wrapper);

          expect(reachesVega(walk)).toBe(false);
          expect(walk.files).not.toContain(deferred);
          // It is a lazy import, and nothing else would defer anything.
          expect(readFileSync(wrapper, "utf8")).toContain(specifier);
        },
      );
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
          specifiersOf('export type Foo = string;\nimport vegaEmbed from "vega-embed";\n'),
        ).toEqual(["vega-embed"]);
      });

      it("records it even where no semicolon closes the type-only line", () => {
        expect(
          specifiersOf('export type Foo = string\nimport vegaEmbed from "vega-embed"\n'),
        ).toEqual(["vega-embed"]);
      });

      it("still discards a type-only import, which no bundler emits", () => {
        expect(specifiersOf('import type { X } from "vega";\n')).toEqual([]);
      });

      it("still reads a specifier across a multi-line brace list", () => {
        expect(specifiersOf('import {\n  a,\n  b,\n} from "vega-lite";\n')).toEqual(["vega-lite"]);
      });
    });
  });
});
