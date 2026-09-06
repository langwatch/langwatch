import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_TENANT_CAP, readTenantCap } from "../scripts";

/**
 * The tenant soft-cap is a defense added post-2026-05-11 incident.
 * As of the noisy-neighbour follow-up it ships ON by default
 * (DEFAULT_TENANT_CAP = 50) so every install gets baseline protection
 * without explicit configuration. Operators retune or kill via
 * LANGWATCH_DISPATCH_TENANT_CAP — these tests pin that contract so a
 * future refactor cannot silently change the default.
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

  /** @scenario Tenant cap defaults to 50 when env var is unset */
  it("defaults to DEFAULT_TENANT_CAP when env var is unset", () => {
    expect(readTenantCap()).toBe(DEFAULT_TENANT_CAP);
    expect(DEFAULT_TENANT_CAP).toBe(50);
  });

  it("falls back to the default for empty string", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "";
    expect(readTenantCap()).toBe(DEFAULT_TENANT_CAP);
  });

  it("falls back to the default for non-numeric values (graceful degradation)", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "not-a-number";
    expect(readTenantCap()).toBe(DEFAULT_TENANT_CAP);
  });

  it("falls back to the default for negative values", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "-5";
    expect(readTenantCap()).toBe(DEFAULT_TENANT_CAP);
  });

  it("returns the integer value when set to a positive number", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "50";
    expect(readTenantCap()).toBe(50);
  });

  /** @scenario Explicit env=0 disables the tenant cap entirely (kill switch) */
  it("returns 0 only when explicitly set to 0 — the kill switch", () => {
    process.env.LANGWATCH_DISPATCH_TENANT_CAP = "0";
    expect(readTenantCap()).toBe(0);
  });
});
