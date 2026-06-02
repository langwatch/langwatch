import { describe, expect, it } from "vitest";
import {
  CONTACT_SALES_URL,
  FREE_PLAN,
  LICENSE_ERRORS,
  LICENSE_ERROR_MESSAGES,
  UNLIMITED_PLAN,
  getUserFriendlyLicenseError,
} from "../constants";

/**
 * Tests for license error message utilities.
 * Verifies that user-friendly error messages are properly mapped.
 */

describe("LICENSE_ERROR_MESSAGES", () => {
  it("maps INVALID_FORMAT to user-friendly message", () => {
    expect(LICENSE_ERROR_MESSAGES[LICENSE_ERRORS.INVALID_FORMAT]).toBe(
      "The license key is invalid or has been tampered with. Please check the key and try again."
    );
  });

  it("maps INVALID_SIGNATURE to user-friendly message", () => {
    expect(LICENSE_ERROR_MESSAGES[LICENSE_ERRORS.INVALID_SIGNATURE]).toBe(
      "The license key is invalid or has been tampered with. Please check the key and try again."
    );
  });

  it("maps EXPIRED to user-friendly message", () => {
    expect(LICENSE_ERROR_MESSAGES[LICENSE_ERRORS.EXPIRED]).toBe(
      "This license has expired. Please contact support to renew your license."
    );
  });
});

describe("getUserFriendlyLicenseError", () => {
  it("returns user-friendly message for invalid format", () => {
    expect(getUserFriendlyLicenseError("Invalid license format")).toBe(
      "The license key is invalid or has been tampered with. Please check the key and try again."
    );
  });

  it("returns user-friendly message for invalid signature", () => {
    expect(getUserFriendlyLicenseError("Invalid signature")).toBe(
      "The license key is invalid or has been tampered with. Please check the key and try again."
    );
  });

  it("returns user-friendly message for expired license", () => {
    expect(getUserFriendlyLicenseError("License expired")).toBe(
      "This license has expired. Please contact support to renew your license."
    );
  });

  it("returns original error for unknown error messages", () => {
    const unknownError = "Some unknown error";
    expect(getUserFriendlyLicenseError(unknownError)).toBe(unknownError);
  });
});

describe("UNLIMITED_PLAN", () => {
  /** @scenario UNLIMITED_PLAN has correct structure for backward compatibility */
  it("has the expected structural shape for self-hosted backward compatibility", () => {
    expect(UNLIMITED_PLAN.type).toBe("OPEN_SOURCE");
    expect(UNLIMITED_PLAN.name).toBe("Open Source");
    expect(UNLIMITED_PLAN.free).toBe(true);
    expect(UNLIMITED_PLAN.overrideAddingLimitations).toBe(true);
    expect(UNLIMITED_PLAN.maxMembers).toBe(Number.MAX_SAFE_INTEGER);
    expect(UNLIMITED_PLAN.maxMembersLite).toBe(Number.MAX_SAFE_INTEGER);
    expect(UNLIMITED_PLAN.maxMessagesPerMonth).toBe(Number.MAX_SAFE_INTEGER);
    expect(UNLIMITED_PLAN.canPublish).toBe(true);
  });
});

describe("CONTACT_SALES_URL", () => {
  /** @scenario CONTACT_SALES_URL resolves to the public demo form */
  it("equals the public LangWatch demo form URL", () => {
    expect(CONTACT_SALES_URL).toBe("https://langwatch.ai/get-a-demo");
  });
});

describe("FREE_PLAN", () => {
  /** @scenario FREE_PLAN has correct limits for expired/invalid licenses */
  /** @scenario PlanInfo defaults maxMembers to 1 when not specified */
  it("has the expected fallback limits for expired/invalid licenses", () => {
    expect(FREE_PLAN.type).toBe("FREE");
    expect(FREE_PLAN.name).toBe("Free");
    expect(FREE_PLAN.free).toBe(true);
    expect(FREE_PLAN.maxMembers).toBe(1);
    expect(FREE_PLAN.maxMembersLite).toBe(0);
    expect(FREE_PLAN.maxMessagesPerMonth).toBe(1000);
    expect(FREE_PLAN.canPublish).toBe(false);
  });
});
