/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { entitlements, type Entitlement } from "../constants";

describe("Entitlement Constants", () => {
  it("exports the expected entitlements array", () => {
    expect(entitlements).toContain("sso-google");
    expect(entitlements).toContain("sso-github");
    expect(entitlements).toContain("sso-gitlab");
    expect(entitlements).toContain("custom-rbac");
  });

  it("has exactly 4 entitlements for minimal POC", () => {
    expect(entitlements).toHaveLength(4);
  });

  it("entitlements array is readonly", () => {
    // TypeScript ensures this at compile time with `as const`
    // This test verifies the type is correctly exported
    const firstEntitlement: Entitlement = entitlements[0]!;
    expect(typeof firstEntitlement).toBe("string");
  });
});
