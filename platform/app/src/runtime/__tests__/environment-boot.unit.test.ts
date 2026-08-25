import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  env,
  getEnvironmentConfig,
  initializeEnvironmentConfig,
  resetEnvironmentConfigForTests,
} from "../../env.mjs";

describe("explicit environment boot", () => {
  beforeEach(() => {
    resetEnvironmentConfigForTests();
  });

  afterEach(() => {
    initializeEnvironmentConfig(process.env);
  });

  it("does not validate merely because the environment module is imported", () => {
    expect(() => getEnvironmentConfig()).toThrow(/not initialized/i);
  });

  it("validates an explicit source once and exposes it to legacy readers", () => {
    const resolved = initializeEnvironmentConfig({
      NODE_ENV: "test",
      BUILD_TIME: "1",
      SKIP_ENV_VALIDATION: "1",
    });

    expect(resolved.NODE_ENV).toBe("test");
    expect(env.NODE_ENV).toBe("test");
    expect(initializeEnvironmentConfig({ NODE_ENV: "production" })).toBe(resolved);
  });
});
