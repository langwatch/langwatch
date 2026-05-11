import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTenantCap } from "../scripts";

/**
 * The tenant soft-cap is a kill-switched defense added post-2026-05-11
 * incident. These tests pin the env-var parsing contract — operators
 * flip the cap on per-environment by setting LANGWATCH_DISPATCH_TENANT_CAP.
 * Pinned here so a future refactor doesn't silently change the default.
 */
describe("readTenantCap", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.LANGWATCH_DISPATCH_TENANT_CAP;
    delete process.env.LANGWATCH_DISPATCH_TENANT_CAP;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.LANGWATCH_DISPATCH_TENANT_CAP;
    } else {
      process.env.LANGWATCH_DISPATCH_TENANT_CAP = originalEnv;
    }
  });

  it("defaults to 0 (disabled) when env var is unset", () => {
    expect(readTenantCap()).toBe(0);
  });

  it("returns 0 when env var is empty string", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "";
    expect(readTenantCap()).toBe(0);
  });

  it("returns 0 for non-numeric values (graceful degradation)", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "not-a-number";
    expect(readTenantCap()).toBe(0);
  });

  it("returns 0 for negative values (disabled)", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "-5";
    expect(readTenantCap()).toBe(0);
  });

  it("returns the integer value when set to a positive number", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "50";
    expect(readTenantCap()).toBe(50);
  });

  it("returns 0 for zero (disabled is the default sentinel)", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "0";
    expect(readTenantCap()).toBe(0);
  });
});
