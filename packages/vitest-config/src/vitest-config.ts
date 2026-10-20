import { globSync, readFileSync } from "node:fs";
import { dirname, join, matchesGlob, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type ViteUserConfig } from "vitest/config";

// Absolute so it resolves the same regardless of the consuming package's cwd.
const CONSOLE_GUARD_SETUP = fileURLToPath(new URL("./console-guard.ts", import.meta.url));
const LOGGER_SETUP = fileURLToPath(new URL("./logger-setup.ts", import.meta.url));

/**
 * The one vitest shape every package declares — vitest 5's speed options
 * (forks pool, on-disk transform cache, isolation off where a package's
 * tests never touch the module registry) — so a config says only what differs.
 */
export interface ModuleVitestConfigOptions {
  /**
   * Chooses the environment, and for `unit` the console-output guard —
   * isolation stays off by default for every kind, `jsdom` included. `unit`
   * is `node` plus the guard, piloted here before rolling out repo-wide.
   */
  kind: "node" | "jsdom" | "unit";
  include?: string[];
  exclude?: string[];
  /**
   * Overrides the default of `false`. Set `true` when a suite mocks modules:
   * `defineModuleVitestConfig` then isolates only the files that rewrite the
   * module registry (`vi.mock`, `vi.doMock`, ...) and lets the rest share one module registry per
   * worker (see `splitIsolationByMocking`). `"all"` isolates every file, for a
   * suite whose files leak state some other way.
   */
  isolate?: boolean | "all";
  /**
   * Globs, relative to the package, for a leak the mock scan cannot see: a
   * module that patches the DOM or a global when it is first imported. A test
   * file that matches one, or imports a file that does by relative path, runs
   * isolated under `isolate: true`. Say what leaks next to the entry.
   */
  alsoIsolate?: string[];
  /** Overrides fast-mode default; set `true` for suites needing CSS processing. */
  css?: boolean;
  setupFiles?: string[];
  testTimeout?: number;
  /** Limits the directory vitest scans for test files. */
  dir?: string;
  /** Merged over everything above, for the handful of packages that need more. */
  test?: ViteUserConfig["test"];
}

const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];

/**
 * Where the real-browser lane's files live. Declared here rather than beside
 * the browser builder so this module can exclude them without importing the
 * Playwright provider — see ./vitest-browser-config.ts, which imports it back.
 */
export const BROWSER_TEST_GLOB = "**/*.browser.test.{ts,tsx}";

// LANGWATCH_VITEST_FAST=1 (default) turns on every perf option vitest 5
// supports that is safe repo-wide; =0 restores the pre-fast-mode config
// exactly, so an isolate-sensitive suite can opt one CI run out without
// touching this file. See dev/docs/plans (vitest perf lane report) for the rationale.
const FAST_MODE = process.env.LANGWATCH_VITEST_FAST !== "0";

export function moduleVitestTestOptions(
  options: ModuleVitestConfigOptions,
): ViteUserConfig["test"] {
  const { kind, include, exclude, isolate, css, setupFiles, testTimeout, dir, test } = options;
  // A fresh worker per file is the single largest cost in a suite whose
  // files share a module graph. Off, the graph is evaluated once per worker.
  const resolvedIsolate = isolate === undefined ? false : isolate !== false;
  const resolvedCss = css ?? !FAST_MODE;
  const resolvedSetupFiles = [
    LOGGER_SETUP,
    ...(kind === "unit" ? [CONSOLE_GUARD_SETUP] : []),
    ...(setupFiles ?? []),
  ];
  return {
    environment: kind === "jsdom" ? "jsdom" : "node",
    isolate: resolvedIsolate,
    pool: "forks",
    // One worker collapses the run onto one child process rather than one per
    // core. Only safe with isolate:false. Was `poolOptions.forks.singleFork`,
    // which vitest 4's pool rework removed. Not absolute: `VITEST_MAX_WORKERS`
    // is applied after the config and outranks it (see
    // ./integration-file-concurrency.ts, and testing-speed.md for both).
    ...(FAST_MODE && !resolvedIsolate ? { maxWorkers: 1 } : {}),
    // Persists transformed modules between runs, so a rerun skips the
    // transform share of the run entirely.
    // https://vitest.dev/config/#fsmodulecache (top-level since vitest 4.0.11)
    fsModuleCache: FAST_MODE,
    // https://vitest.dev/config/#fileparallelism
    fileParallelism: true,
    // Skips CSS parse/transform on import. No package under this builder
    // asserts on real computed CSS. https://vitest.dev/config/#css
    css: resolvedCss,
    watch: false,
    // Appended rather than defaulted: a package passing its own `exclude`
    // replaces the default list outright, and vitest's default include
    // (`**/*.test.?(c|m)[jt]s?(x)`) matches `*.browser.test.tsx` too. Without
    // this the jsdom lane collects the browser lane's files and fails them on
    // a `vitest/browser` import jsdom cannot answer.
    exclude: [...(exclude ?? DEFAULT_EXCLUDE), BROWSER_TEST_GLOB],
    ...(include ? { include } : {}),
    setupFiles: resolvedSetupFiles,
    ...(testTimeout === undefined ? {} : { testTimeout }),
    ...(dir === undefined ? {} : { dir }),
    ...test,
  };
}

// Vitest's own default, used when a package names no include of its own.
const DEFAULT_INCLUDE = ["**/*.{test,spec}.?(c|m)[jt]s?(x)"];
// The calls that rewrite the module registry, the rule in testing-speed.md.
const MOCKS_MODULES = /\bvi\s*\.\s*(?:mock|doMock|unmock|doUnmock|resetModules)\s*\(/;
const GLOB_SPECIAL = /[*?[\]{}()!+@]/g;

type TestOptions = NonNullable<ViteUserConfig["test"]>;

/**
 * Isolation exists for one reason in this repo: `vi.mock` does not reach a
 * module another file already loaded into a shared registry, so a mocking file
 * that runs after its target was imported tests the real module, and its mock
 * can leak into the next file. Only the files that mock pay for that. They run
 * in an isolated project; every other file runs where each worker loads the
 * module graph once. In the trace explorer suite, 76% of an isolated run was
 * re-importing modules and rebuilding jsdom per file.
 *
 * A file moves between the two the moment it gains or drops a mock, so there
 * is no list to keep. Returns the options unchanged when every matched file, or
 * none, mocks.
 */
export function splitIsolationByMocking({
  test,
  root,
  alsoIsolate = [],
  read = (file) => readFileSync(file, "utf8"),
}: {
  test: TestOptions;
  root: string;
  alsoIsolate?: string[];
  read?: (file: string) => string;
}): TestOptions {
  if (test.isolate !== true) return test;
  const base = test.dir === undefined ? root : join(root, test.dir);
  const exclude = test.exclude ?? DEFAULT_EXCLUDE;
  const files = globSync(test.include ?? DEFAULT_INCLUDE, {
    cwd: base,
    exclude: (entry) => /(^|\/)(node_modules|dist)$/.test(String(entry)),
  })
    .filter((file) => !exclude.some((pattern) => matchesGlob(file, pattern)))
    .toSorted();
  const named = (file: string) => {
    const path = relative(root, file);
    return alsoIsolate.some((pattern) => matchesGlob(path, pattern));
  };
  const needsIsolation = reachesIsolation({ read, named });
  const mocking = files.filter((file) => needsIsolation(join(base, file)));
  if (mocking.length === 0 || mocking.length === files.length) return test;

  const asGlobs = mocking.map((file) => file.replace(GLOB_SPECIAL, "\\$&"));
  return {
    ...test,
    projects: [
      {
        extends: true,
        test: { name: "shared-modules", isolate: false, exclude: [...exclude, ...asGlobs] },
      },
      { extends: true, test: { name: "isolated", isolate: true, include: asGlobs } },
    ],
  };
}

const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'](\.{1,2}\/[^"']+)["']/g;
const SOURCE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  "/index.ts",
  "/index.tsx",
];

/**
 * Whether a test file, or a file it imports by relative path, rewrites the
 * module registry or is one the suite names in `alsoIsolate`. A shared test
 * harness that calls `vi.mock` for every file importing it is the common case
 * the file's own text would miss; package imports are not followed, since a
 * package's source never mocks.
 */
function reachesIsolation({
  read,
  named,
}: {
  read: (file: string) => string;
  named: (file: string) => boolean;
}): (file: string) => boolean {
  const memo = new Map<string, boolean>();
  const visit = (file: string): boolean => {
    const known = memo.get(file);
    if (known !== undefined) return known;
    memo.set(file, false); // a cycle reaches nothing new
    let text: string;
    try {
      text = read(file);
    } catch {
      return false;
    }
    if (named(file) || MOCKS_MODULES.test(text)) {
      memo.set(file, true);
      return true;
    }
    for (const [, specifier] of text.matchAll(RELATIVE_IMPORT)) {
      const target = resolveRelative(resolve(dirname(file), specifier!), read);
      if (target && visit(target)) {
        memo.set(file, true);
        return true;
      }
    }
    return false;
  };
  return visit;
}

function resolveRelative(path: string, read: (file: string) => string): string | undefined {
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = path + extension;
    try {
      read(candidate);
      return candidate;
    } catch {
      // not this extension
    }
  }
  return undefined;
}

export function defineModuleVitestConfig(options: ModuleVitestConfigOptions): ViteUserConfig {
  const test = moduleVitestTestOptions(options) ?? {};
  return defineConfig({
    // The UI ships through the React Compiler (apps/ui/vite.config.ts); jsdom tests match it.
    plugins: options.kind === "jsdom" ? [react({ compiler: true })] : [],
    // vitest runs every package script from the package directory, which is
    // where the include globs are rooted.
    test:
      FAST_MODE && options.isolate === true
        ? splitIsolationByMocking({ test, root: process.cwd(), alsoIsolate: options.alsoIsolate })
        : test,
  });
}
