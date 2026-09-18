import { fileURLToPath } from "node:url";

import { defineConfig, type ViteUserConfig } from "vitest/config";

// Absolute so it resolves the same regardless of the consuming package's cwd.
const CONSOLE_GUARD_SETUP = fileURLToPath(new URL("./console-guard.ts", import.meta.url));

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
  /** Overrides the default of `false`. Set `true` when a suite mocks modules. */
  isolate?: boolean;
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
  const resolvedIsolate = isolate ?? false;
  const resolvedCss = css ?? !FAST_MODE;
  const resolvedSetupFiles =
    kind === "unit" ? [CONSOLE_GUARD_SETUP, ...(setupFiles ?? [])] : setupFiles;
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
    ...(resolvedSetupFiles ? { setupFiles: resolvedSetupFiles } : {}),
    ...(testTimeout === undefined ? {} : { testTimeout }),
    ...(dir === undefined ? {} : { dir }),
    ...test,
  };
}

export function defineModuleVitestConfig(options: ModuleVitestConfigOptions): ViteUserConfig {
  return defineConfig({ test: moduleVitestTestOptions(options) });
}
