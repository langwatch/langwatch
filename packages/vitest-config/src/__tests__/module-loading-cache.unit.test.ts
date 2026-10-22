import { afterEach, describe, expect, it, vi } from "vitest";

import { moduleLoadingCacheExecArgv } from "../module-loading-cache.ts";
import { moduleVitestTestOptions } from "../vitest-config.ts";

const REGISTER_PATH = /module-loading-cache\/register\.ts$/;

describe("moduleLoadingCacheExecArgv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("imports the worker hooks on a local run", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", undefined);

    expect(moduleLoadingCacheExecArgv()).toEqual([
      "--import",
      expect.stringMatching(REGISTER_PATH),
    ]);
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("adds nothing in CI", () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", undefined);

    expect(moduleLoadingCacheExecArgv()).toEqual([]);
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("lets LANGWATCH_VITEST_MODULE_CACHE outrank both", () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", "1");
    expect(moduleLoadingCacheExecArgv()).toHaveLength(2);

    vi.stubEnv("CI", "");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", "0");
    expect(moduleLoadingCacheExecArgv()).toEqual([]);
  });
});

describe("moduleVitestTestOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("when the shared config is resolved for a local run", () => {
    /** @scenario "The shared config loads the cache into every worker" */
    it("carries the --import of the register file in execArgv", () => {
      vi.stubEnv("CI", "");
      vi.stubEnv("LANGWATCH_VITEST_FAST", undefined);
      vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", undefined);

      const options = moduleVitestTestOptions({ kind: "node" });

      expect(options?.execArgv).toEqual(["--import", expect.stringMatching(REGISTER_PATH)]);
    });
  });

  describe("when the shared config is resolved in CI", () => {
    /** @scenario "The shared config loads the cache into every worker" */
    it("carries no execArgv entries", () => {
      vi.stubEnv("CI", "true");
      vi.stubEnv("LANGWATCH_VITEST_FAST", undefined);
      vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", undefined);

      expect(moduleVitestTestOptions({ kind: "node" })?.execArgv).toEqual([]);
    });
  });

  describe("when fast mode is off", () => {
    /** @scenario "Fast mode off leaves the workers as they were" */
    it("gives the workers no extra Node options", () => {
      vi.stubEnv("CI", "");
      vi.stubEnv("LANGWATCH_VITEST_FAST", "0");

      expect(moduleVitestTestOptions({ kind: "node" })).not.toHaveProperty("execArgv");
    });
  });
});
