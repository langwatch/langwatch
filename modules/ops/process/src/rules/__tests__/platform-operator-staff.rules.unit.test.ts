/**
 * Who counts as staff, and where grants are kept to staff.
 * Spec: modules/ops/specs/platform-operator-bootstrap.feature
 */
import { describe, expect, it } from "vitest";

import {
  grantsAreStaffOnly,
  isStaffAccount,
  PLATFORM_OPERATOR_STAFF_DOMAIN,
} from "../platform-operator-staff.rules.ts";

describe("isStaffAccount", () => {
  describe("given a verified address", () => {
    /** @scenario "On the hosted cloud the page and the task grant a verified staff account" */
    it("answers yes on the staff domain, whatever its case", () => {
      expect(PLATFORM_OPERATOR_STAFF_DOMAIN).toBe("langwatch.ai");
      expect(isStaffAccount({ email: "bo@langwatch.ai", emailVerified: true })).toBe(true);
      expect(isStaffAccount({ email: "Bo@LangWatch.AI", emailVerified: true })).toBe(true);
    });

    /** @scenario "On the hosted cloud an account outside the staff domain is refused" */
    it.each([
      "bo@acme.com",
      "bo@eu.langwatch.ai",
      "bo@langwatch.ai.acme.com",
      "bo@notlangwatch.ai",
      "bo@langwatch.ai.",
      "bo@acme.com@langwatch.ai",
      "langwatch.ai",
    ])("answers no for %s", (email) => {
      expect(isStaffAccount({ email, emailVerified: true })).toBe(false);
    });
  });

  describe("given an address never verified or absent", () => {
    /** @scenario "On the hosted cloud an unverified staff address is refused" */
    it("answers no", () => {
      expect(isStaffAccount({ email: "bo@langwatch.ai", emailVerified: false })).toBe(false);
      expect(isStaffAccount({ email: null, emailVerified: true })).toBe(false);
    });
  });
});

describe("grantsAreStaffOnly", () => {
  it("keeps grants to staff on a deployment LangWatch runs", () => {
    expect(grantsAreStaffOnly({ cloud: true, isLocalDevelopment: false })).toBe(true);
  });

  /** @scenario "A self-hosted install grants any verified active account" */
  it("leaves a self-hosted install open to any verified account", () => {
    expect(grantsAreStaffOnly({ cloud: false, isLocalDevelopment: false })).toBe(false);
  });

  /** @scenario "A developer's local stack grants its own seeded admin" */
  it("leaves a developer's local stack open, as it runs Cloud admin for everyone", () => {
    expect(grantsAreStaffOnly({ cloud: true, isLocalDevelopment: true })).toBe(false);
  });
});
