import { afterEach, describe, expect, it, vi } from "vitest";

import { moduleVitestTestOptions } from "../vitest-config.ts";

const REGISTER_PATH = /module-loading-cache\/register\.ts$/;

/** The Node options the shared config gives each worker, fast mode on. */
function workerExecArgv() {
  vi.stubEnv("LANGWATCH_VITEST_FAST", undefined);
  return moduleVitestTestOptions({ kind: "node" })?.execArgv;
}

describe("the module loading cache in the shared config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("is loaded into the workers on a local run", () => {
    vi.stubEnv("CI", "");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", undefined);

    expect(workerExecArgv()).toEqual(["--import", expect.stringMatching(REGISTER_PATH)]);
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("is not loaded in CI", () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", undefined);

    expect(workerExecArgv()).toBeUndefined();
  });

  /** @scenario "The cache is on for local runs and off in CI unless asked" */
  it("lets LANGWATCH_VITEST_MODULE_CACHE outrank both", () => {
    vi.stubEnv("CI", "true");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", "1");
    expect(workerExecArgv()).toEqual(["--import", expect.stringMatching(REGISTER_PATH)]);

    vi.stubEnv("CI", "");
    vi.stubEnv("LANGWATCH_VITEST_MODULE_CACHE", "0");
    expect(workerExecArgv()).toBeUndefined();
  });
});

describe("moduleVitestTestOptions", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
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
