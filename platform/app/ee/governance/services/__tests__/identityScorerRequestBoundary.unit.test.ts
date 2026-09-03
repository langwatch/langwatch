// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Where the name scorer is allowed to be reached from (ADR-128 §12's Gate).
 *
 * The scorer is quadratic in two populations, and at ADR-128's own example size
 * — 2,000 discovered people against 500 accounts — the million pairs measured
 * 2.9 seconds of blocked event loop. One ordinary-looking import from a router
 * is all it takes to put that on a page load, with nothing visibly wrong at the
 * call site. The import graph is what decides, so the import graph is pinned.
 *
 * Three claims, weakest to strongest:
 *
 *  1. exactly one module imports the scorer, and it is the background job;
 *  2. exactly one module imports that job, and it is the composition root;
 *  3. walking out from the request surfaces never arrives at the scorer.
 *
 * The third treats the composition root as a leaf, and that exclusion is stated
 * rather than hidden: `presets.ts` composes every service in the process and is
 * reachable from everything by construction, so including it would make the
 * walk say only that a composition root exists. What the walk is actually for
 * is a procedure reaching the scorer through some intermediate service — a
 * chain claims 1 and 2 cannot see. All three together are the gate; any one of
 * them alone has a hole the other two cover.
 *
 * Node environment on purpose — this reads source and evaluates none of it.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 * Decision: ADR-128 §12
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `…/ee/governance/services/__tests__` → `…/platform/app`. */
const APP_DIR = resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
);
const SRC_DIR = join(APP_DIR, "src");
const EE_DIR = join(APP_DIR, "ee");

const SCORER = join(EE_DIR, "governance/services/logic/nameSimilarity.ts");
const SUGGESTION_JOB = join(
  EE_DIR,
  "governance/services/identityMatchSuggestion.service.ts",
);
const COMPOSITION_ROOT = join(SRC_DIR, "server/app-layer/presets.ts");

/**
 * Everything that serves a request.
 *
 * `root.ts` composes every tRPC router — including the enterprise ones, through
 * the `@ee/` alias — and `api-router.ts` composes every Hono route and mounts
 * tRPC underneath, so between them they cover both surfaces. The governance
 * routers are named as roots too, redundantly and on purpose: a router dropped
 * from the composed tree stops being covered by the two files above, and
 * silently, which is the direction this file must not fail in.
 */
const REQUEST_ROOTS = [
  join(SRC_DIR, "server/api/root.ts"),
  join(SRC_DIR, "server/api-router.ts"),
  ...readdirSync(join(EE_DIR, "governance/routers"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => join(EE_DIR, "governance/routers", entry.name)),
];

const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js"];

/**
 * Static `import`/`export … from` specifiers. Deliberately not `import()`.
 *
 * The clause between the keyword and `from` is bounded so one match cannot span
 * two statements. Unbounded it could, and the cost is not a duplicate — it is a
 * MISS: a type-only line followed by a runtime import matches as one span,
 * which the type-only filter then discards whole, taking the runtime import
 * with it. The scan would report a clean graph while the scorer was statically
 * imported. Same reasoning, same regex, as `vegaLazyBoundary.unit.test.ts`.
 */
const STATIC_IMPORT =
  /(?:^|\n)\s*(?:import|export)(?:[^;\n]|\n(?!\s*(?:import|export)\b))*?\sfrom\s+["']([^"']+)["']|(?:^|\n)\s*import\s+["']([^"']+)["']/g;

/** `import type` and `export type` are erased before anything runs them. */
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

/** The repo's own path aliases, as `tsconfig` and the bundler resolve them. */
const ALIASES: [prefix: string, target: string][] = [
  ["~/", SRC_DIR],
  ["@app/", join(SRC_DIR, "server", "app-layer")],
  ["@ee/", EE_DIR],
];

function resolveLocal({
  specifier,
  fromFile,
}: {
  specifier: string;
  fromFile: string;
}): string | null {
  const alias = ALIASES.find(([prefix]) => specifier.startsWith(prefix));
  const base = alias
    ? join(alias[1], specifier.slice(alias[0].length))
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

/**
 * Every local file reachable from a root by static import, stopping at
 * anything named as a leaf.
 *
 * Iterative rather than recursive: this codebase has import cycles by design
 * (ADR-070), and a recursive walk that cuts one would answer "cannot reach"
 * for a reason that has nothing to do with the question.
 */
function reachableFiles({
  roots,
  leaves = new Set<string>(),
}: {
  roots: readonly string[];
  leaves?: ReadonlySet<string>;
}): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    if (leaves.has(file)) continue;

    for (const specifier of specifiersOf(readFileSync(file, "utf8"))) {
      const local = resolveLocal({ specifier, fromFile: file });
      if (local !== null) queue.push(local);
    }
  }

  return seen;
}

/** Every source file in the app, tests and generated code excluded. */
function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ["__tests__", "__mocks__", "node_modules", "generated"].includes(
        entry.name,
      )
        ? []
        : sourceFiles(path);
    }
    if (entry.name.endsWith(".d.ts")) return [];
    if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return EXTENSIONS.some((extension) => entry.name.endsWith(extension))
      ? [path]
      : [];
  });
}

/** Files that import `target` directly, as paths relative to `platform/app`. */
function directImportersOf(target: string): string[] {
  return [...sourceFiles(SRC_DIR), ...sourceFiles(EE_DIR)]
    .filter((file) =>
      specifiersOf(readFileSync(file, "utf8")).some(
        (specifier) => resolveLocal({ specifier, fromFile: file }) === target,
      ),
    )
    .map((file) => relative(APP_DIR, file))
    .sort();
}

describe("Feature: where the name scorer can be reached from", () => {
  describe("given the modules that import the scorer", () => {
    it("finds exactly the background job, and nothing else", () => {
      expect(directImportersOf(SCORER)).toEqual([
        relative(APP_DIR, SUGGESTION_JOB),
      ]);
    });
  });

  describe("given the modules that import the background job", () => {
    it("finds exactly the composition root, which only builds it on the worker role", () => {
      expect(directImportersOf(SUGGESTION_JOB)).toEqual([
        relative(APP_DIR, COMPOSITION_ROOT),
      ]);
    });
  });

  describe("given every path that serves a request", () => {
    /** @scenario "Nothing that answers a request ever compares two names" */
    it("never arrives at the scorer", () => {
      const reached = reachableFiles({
        roots: REQUEST_ROOTS,
        // See the file docblock: the composition root is imported by everything
        // by construction, so including it would make this assert only that a
        // composition root exists. Claims 1 and 2 above are what guard the
        // route through it.
        leaves: new Set([COMPOSITION_ROOT]),
      });

      const arrivals = [SCORER, SUGGESTION_JOB]
        .filter((file) => reached.has(file))
        .map((file) => relative(APP_DIR, file));

      expect(arrivals).toEqual([]);
    });

    it("does arrive at the match engine, so the walk is not passing vacuously", () => {
      // Without this the assertion above would hold just as well against a
      // walker that resolves nothing at all. The match engine IS request-facing
      // — the review surface reads through it — so reaching it is the proof
      // that the same walk would have reached the scorer had one been imported.
      const reached = reachableFiles({
        roots: REQUEST_ROOTS,
        leaves: new Set([COMPOSITION_ROOT]),
      });

      expect(reached.size).toBeGreaterThan(100);
      expect(
        reached.has(join(EE_DIR, "governance/routers/governanceCost.ts")),
      ).toBe(true);
    });
  });

  /**
   * The scan is only as good as what it can see, and its failure direction is
   * silent: a specifier it never records is a leak it reports as clean. These
   * read the reader.
   */
  describe("given the specifier scan itself", () => {
    it("records a runtime import that a type-only line precedes", () => {
      expect(
        specifiersOf(
          'export type Foo = string;\nimport { nameSimilarity } from "./logic/nameSimilarity";\n',
        ),
      ).toEqual(["./logic/nameSimilarity"]);
    });

    it("records it even where no semicolon closes the type-only line", () => {
      expect(
        specifiersOf(
          'export type Foo = string\nimport { nameSimilarity } from "./logic/nameSimilarity"\n',
        ),
      ).toEqual(["./logic/nameSimilarity"]);
    });

    it("discards a type-only import, which nothing ever runs", () => {
      expect(
        specifiersOf('import type { X } from "./logic/nameSimilarity";\n'),
      ).toEqual([]);
    });

    it("reads a specifier across a multi-line brace list", () => {
      expect(
        specifiersOf(
          'import {\n  isWorthScoring,\n  nameSimilarity,\n} from "./logic/nameSimilarity";\n',
        ),
      ).toEqual(["./logic/nameSimilarity"]);
    });

    it("resolves each of the aliases a router would reach the scorer through", () => {
      for (const specifier of [
        "@ee/governance/services/logic/nameSimilarity",
        "~/server/app-layer/presets",
        "@app/presets",
      ]) {
        expect(
          resolveLocal({ specifier, fromFile: join(SRC_DIR, "server/x.ts") }),
        ).not.toBeNull();
      }
    });
  });
});
