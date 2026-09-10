import { defineConfig, type ViteUserConfig } from "vitest/config";

/**
 * The one vitest shape every package in the workspace declares. It carries the
 * speed options vitest 5 exposes - a forks pool, the on-disk transform cache,
 * and isolation off wherever the package's tests never touch the module
 * registry - so a package's own config says only what is different about it.
 */
export interface ModuleVitestConfigOptions {
  /** `node` runs with isolation off by default; `jsdom` keeps isolation on. */
  kind: "node" | "jsdom";
  include?: string[];
  exclude?: string[];
  /** Overrides the default for the kind. Set `true` when a suite mocks modules. */
  isolate?: boolean;
  setupFiles?: string[];
  testTimeout?: number;
  /** Limits the directory vitest scans for test files. */
  dir?: string;
  /** Merged over everything above, for the handful of packages that need more. */
  test?: ViteUserConfig["test"];
}

const DEFAULT_EXCLUDE = ["**/node_modules/**", "**/dist/**"];

export function moduleVitestTestOptions(
  options: ModuleVitestConfigOptions,
): ViteUserConfig["test"] {
  const { kind, include, exclude, isolate, setupFiles, testTimeout, dir, test } = options;
  return {
    environment: kind === "jsdom" ? "jsdom" : "node",
    // A fresh worker per file is the single largest cost in a suite whose
    // files share a module graph. Off, the graph is evaluated once per worker.
    isolate: isolate ?? kind === "jsdom",
    pool: "forks",
    // Persists transformed modules between runs, so a rerun skips the
    // transform share of the run entirely.
    fsModuleCache: true,
    fileParallelism: true,
    watch: false,
    exclude: exclude ?? DEFAULT_EXCLUDE,
    ...(include ? { include } : {}),
    ...(setupFiles ? { setupFiles } : {}),
    ...(testTimeout === undefined ? {} : { testTimeout }),
    ...(dir === undefined ? {} : { dir }),
    ...test,
  };
}

export function defineModuleVitestConfig(options: ModuleVitestConfigOptions): ViteUserConfig {
  return defineConfig({ test: moduleVitestTestOptions(options) });
}
