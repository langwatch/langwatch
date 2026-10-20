import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type ViteUserConfig } from "vitest/config";

import { splitIsolationByMocking } from "./split-isolation-by-mocking.ts";

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
   * Overrides the default of `false`. `true` isolates only the files that mock
   * modules (see testing-speed.md), and none when no file does; `"all"`
   * isolates every file, for a suite that leaks state some other way.
   */
  isolate?: boolean | "all";
  /**
   * Globs, relative to the package, for a leak the mock scan cannot see, like a
   * module that patches the DOM on import. A file matching one, or importing
   * one by relative path, runs isolated. Say what leaks.
   */
  alsoIsolate?: string[];
  /** Overrides fast-mode default; set `true` for suites needing CSS processing. */
  css?: boolean;
  setupFiles?: string[];
  testTimeout?: number;
  /** Limits the directory vitest scans for test files. */
  dir?: string;
  /** vitest's root, and where the isolation split scans; the cwd when unset. */
  root?: string;
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
// touching this file. Rationale: dev/docs/best_practices/testing-speed.md.
// Read per config, not at import, so a test can turn it off.
const fastMode = () => process.env.LANGWATCH_VITEST_FAST !== "0";

type TestOptions = NonNullable<ViteUserConfig["test"]>;

export function moduleVitestTestOptions(
  options: ModuleVitestConfigOptions,
): ViteUserConfig["test"] {
  const { kind, include, exclude, isolate, css, setupFiles, testTimeout, dir, root, test } = options;
  // A fresh worker per file is the single largest cost in a suite whose
  // files share a module graph. Off, the graph is evaluated once per worker.
  const resolvedIsolate = isolate === undefined ? false : isolate !== false;
  const fast = fastMode();
  const resolvedCss = css ?? !fast;
  const resolvedSetupFiles = [
    LOGGER_SETUP,
    ...(kind === "unit" ? [CONSOLE_GUARD_SETUP] : []),
    ...(setupFiles ?? []),
  ];
  const resolved: TestOptions = {
    environment: kind === "jsdom" ? "jsdom" : "node",
    isolate: resolvedIsolate,
    pool: "forks",
    // One worker collapses the run onto one child process rather than one per
    // core. Only safe with isolate:false. Was `poolOptions.forks.singleFork`,
    // which vitest 4's pool rework removed. Not absolute: `VITEST_MAX_WORKERS`
    // is applied after the config and outranks it (see
    // ./integration-file-concurrency.ts, and testing-speed.md for both).
    ...(fast && !resolvedIsolate ? { maxWorkers: 1 } : {}),
    // Persists transformed modules between runs, so a rerun skips the
    // transform share of the run entirely.
    // https://vitest.dev/config/#fsmodulecache (top-level since vitest 4.0.11)
    fsModuleCache: fast,
    // https://vitest.dev/config/#fileparallelism
    fileParallelism: true,
    // Skips CSS parse/transform on import. No package under this builder
    // asserts on real computed CSS. https://vitest.dev/config/#css
    css: resolvedCss,
    watch: false,
    // Appended, not defaulted: a package's own `exclude` replaces the default,
    // and vitest's default include matches `*.browser.test.tsx` too, so the
    // jsdom lane would collect the browser lane's files and fail them.
    exclude: [...(exclude ?? DEFAULT_EXCLUDE), BROWSER_TEST_GLOB],
    ...(include ? { include } : {}),
    setupFiles: resolvedSetupFiles,
    ...(testTimeout === undefined ? {} : { testTimeout }),
    ...(dir === undefined ? {} : { dir }),
    ...test,
  };
  // Every way of asking for isolation, the `test` override included, isolates
  // only the files that need it. `"all"` and fast mode off keep the whole suite.
  return fast && isolate !== "all" && resolved.isolate === true
    ? splitIsolationByMocking({
        test: resolved,
        // vitest runs a package script from the package directory, its default root.
        root: root ?? process.cwd(),
        alsoIsolate: options.alsoIsolate,
      })
    : resolved;
}

export function defineModuleVitestConfig(options: ModuleVitestConfigOptions): ViteUserConfig {
  const test = moduleVitestTestOptions(options) ?? {};
  return defineConfig({
    ...(options.root === undefined ? {} : { root: options.root }),
    // The UI ships through the React Compiler (apps/ui/vite.config.ts); jsdom tests match it.
    plugins: options.kind === "jsdom" ? [react({ compiler: true })] : [],
    test,
  });
}
