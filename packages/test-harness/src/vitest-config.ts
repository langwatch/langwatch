import { fileURLToPath } from "node:url";
import { defineConfig, type ViteUserConfig } from "vitest/config";

// Absolute so it resolves the same regardless of the consuming package's cwd.
const CONSOLE_GUARD_SETUP = fileURLToPath(new URL("./console-guard.ts", import.meta.url));

/**
 * The one vitest shape every package in the workspace declares. It carries the
 * speed options vitest 5 exposes - a forks pool, the on-disk transform cache,
 * and isolation off wherever the package's tests never touch the module
 * registry - so a package's own config says only what is different about it.
 */
export interface ModuleVitestConfigOptions {
  /**
   * Chooses the environment, and for `unit` the console-output guard. It does
   * not change isolation: every kind runs with isolation off by default,
   * `jsdom` included. `unit` is `node` plus the guard (piloted here first,
   * before it rolls out to every unit suite).
   */
  kind: "node" | "jsdom" | "unit";
  include?: string[];
  exclude?: string[];
  /** Overrides the default of `false`. Set `true` when a suite mocks modules. */
  isolate?: boolean;
  /** Overrides the fast-mode default (`false`). Set `true` for a suite that breaks with CSS processing off. */
  css?: boolean;
  setupFiles?: string[];
  testTimeout?: number;
  /** Limits the directory vitest scans for test files. */
  dir?: string;
  /** Merged over everything above, for the handful of packages that need more. */
  test?: ViteUserConfig["test"];
}

const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];

// LANGWATCH_VITEST_FAST=1 (default) turns on every perf option vitest 5
// supports that is safe repo-wide; =0 restores the pre-fast-mode config
// exactly, so a package with an isolate-sensitive suite can opt a single CI
// run out without touching this file or its own vitest.config.ts.
// See dev/docs/plans (vitest perf lane report) for the option-by-option
// rationale and doc links.
const FAST_MODE = process.env.LANGWATCH_VITEST_FAST !== "0";

export function moduleVitestTestOptions(
  options: ModuleVitestConfigOptions,
): ViteUserConfig["test"] {
  const { kind, include, exclude, isolate, css, setupFiles, testTimeout, dir, test } = options;
  // A fresh worker per file is the single largest cost in a suite whose
  // files share a module graph. Off, the graph is evaluated once per worker.
  const resolvedIsolate = isolate ?? false;
  const resolvedCss = css ?? (FAST_MODE ? false : true);
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
    exclude: exclude ?? DEFAULT_EXCLUDE,
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
