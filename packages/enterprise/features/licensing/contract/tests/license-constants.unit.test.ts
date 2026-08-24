import { describe, expect, it } from "vitest";
import {
  CONTACT_SALES_URL,
  FREE_PLAN,
  LICENSE_ERRORS,
  UNLIMITED_PLAN,
} from "../src";
import { licenseValidationError } from "../src";

/**
 * The prose-keyed `LICENSE_ERROR_MESSAGES` / `getUserFriendlyLicenseError`
 * pair is gone: customer copy is keyed by error `code` in the presentation
 * registry now, and the only thing that still reads a `LICENSE_ERRORS`
 * literal is `licenseValidationError`, which maps a verdict onto that code.
 * What is worth pinning is that mapping — and that it fails closed.
 */
describe("licenseValidationError", () => {
  describe("given a verdict from validateLicense", () => {
    it("maps an expired licence to license_expired", () => {
      expect(licenseValidationError(LICENSE_ERRORS.EXPIRED).code).toBe(
        "license_expired",
      );
    });

    it("maps a malformed key to license_key_invalid", () => {
      expect(licenseValidationError(LICENSE_ERRORS.INVALID_FORMAT).code).toBe(
        "license_key_invalid",
      );
    });

    it("maps a bad signature to license_key_invalid", () => {
      expect(
        licenseValidationError(LICENSE_ERRORS.INVALID_SIGNATURE).code,
      ).toBe("license_key_invalid");
    });
  });

  describe("when the verdict is one nothing here recognises", () => {
    it("still rejects the licence rather than failing open", () => {
      expect(licenseValidationError("something new").code).toBe(
        "license_key_invalid",
      );
      expect(licenseValidationError(undefined).code).toBe(
        "license_key_invalid",
      );
    });
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
  /** @scenario FREE_PLAN has the Cloud free-tier limits */
  /** @scenario PlanInfo defaults maxMembers to 1 when not specified */
  it("has the Cloud free-tier limits", () => {
    expect(FREE_PLAN.type).toBe("FREE");
    expect(FREE_PLAN.name).toBe("Free");
    expect(FREE_PLAN.free).toBe(true);
    expect(FREE_PLAN.maxMembers).toBe(1);
    expect(FREE_PLAN.maxMembersLite).toBe(0);
    expect(FREE_PLAN.maxMessagesPerMonth).toBe(1000);
    expect(FREE_PLAN.canPublish).toBe(false);
  });
});
