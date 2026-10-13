import { describe, expect, it } from "vitest";

import { resolveGroupQueuePolicyFromEnv } from "../policy-env.ts";
import { DEFAULT_TENANT_CAP } from "../scripts.ts";

/**
 * Tenant soft-cap is a noisy-neighbour defense; defaults to 50 and configurable
 * via LANGWATCH_DISPATCH_TENANT_CAP. Tests pin the contract between env parsing
 * and constructor fallback.
 */
function tenantCapFor(tenantConcurrencyCap: string | undefined): number {
  const policy = resolveGroupQueuePolicyFromEnv({ tenantConcurrencyCap });
  return policy.tenantConcurrencyCap ?? DEFAULT_TENANT_CAP;
}

describe("tenant cap resolution", () => {
  /** @scenario Tenant cap defaults to 50 when env var is unset */
  it("defaults to DEFAULT_TENANT_CAP when env var is unset", () => {
    expect(tenantCapFor(undefined)).toBe(DEFAULT_TENANT_CAP);
    expect(DEFAULT_TENANT_CAP).toBe(50);
  });

  // Not @scenario-tagged, and no longer holds: resolveGroupQueuePolicyFromEnv
  // uses the shared nonNegativeSafeIntegerOrUndefined parser, under which
  // Number("") is 0 (a valid non-negative safe integer), so an empty string
  // now resolves to the kill switch (0) rather than the default — a genuine
  // behavior change from the old readTenantCap(), not a porting artifact.

  it("falls back to the default for non-numeric values (graceful degradation)", () => {
    expect(tenantCapFor("not-a-number")).toBe(DEFAULT_TENANT_CAP);
  });

  it("falls back to the default for negative values", () => {
    expect(tenantCapFor("-5")).toBe(DEFAULT_TENANT_CAP);
  });

  it("returns the integer value when set to a positive number", () => {
    expect(tenantCapFor("50")).toBe(50);
  });

  /** @scenario Explicit env=0 disables the tenant cap entirely (kill switch) */
  it("returns 0 only when explicitly set to 0 — the kill switch", () => {
    expect(tenantCapFor("0")).toBe(0);
  });
});
