import { describe, expect, it } from "vitest";
import {
  isExpired,
  parseLicenseKey,
  validateLicense,
  verifySignature,
} from "../validation";
import {
  BASE_LICENSE,
  VALID_LICENSE_KEY,
  EXPIRED_LICENSE_KEY,
  TAMPERED_LICENSE_KEY,
  EMPTY_SIGNATURE_KEY,
  MALFORMED_BASE64,
  INVALID_JSON_BASE64,
  GARBAGE_DATA,
} from "./fixtures/testLicenses";
import { TEST_PUBLIC_KEY, WRONG_PUBLIC_KEY } from "./fixtures/testKeys";

describe("parseLicenseKey", () => {
  it("parses valid base64-encoded license key", () => {
    const result = parseLicenseKey(VALID_LICENSE_KEY);

    expect(result).not.toBeNull();
    expect(result?.data.organizationName).toBe("Acme Corp");
    expect(result?.signature).toBeDefined();
  });

  it("returns null for malformed base64 input", () => {
    const result = parseLicenseKey(MALFORMED_BASE64);

    expect(result).toBeNull();
  });

  it("returns null for valid base64 but invalid JSON", () => {
    const result = parseLicenseKey(INVALID_JSON_BASE64);

    expect(result).toBeNull();
  });

  it("returns null for empty license key", () => {
    const result = parseLicenseKey("");

    expect(result).toBeNull();
  });

  it("returns null for whitespace-only license key", () => {
    const result = parseLicenseKey("   ");

    expect(result).toBeNull();
  });

  it("returns null for valid JSON but missing required fields", () => {
    const invalidStructure = Buffer.from(
      JSON.stringify({ foo: "bar" })
    ).toString("base64");

    const result = parseLicenseKey(invalidStructure);

    expect(result).toBeNull();
  });
});

describe("verifySignature", () => {
  it("verifies valid RSA-SHA256 signature", () => {
    const signedLicense = parseLicenseKey(VALID_LICENSE_KEY);

    expect(signedLicense).not.toBeNull();
    if (!signedLicense) throw new Error("Expected signedLicense to be defined");
    const result = verifySignature(signedLicense, TEST_PUBLIC_KEY);

    expect(result).toBe(true);
  });

  it("rejects tampered license data", () => {
    const signedLicense = parseLicenseKey(TAMPERED_LICENSE_KEY);

    expect(signedLicense).not.toBeNull();
    if (!signedLicense) throw new Error("Expected signedLicense to be defined");
    const result = verifySignature(signedLicense, TEST_PUBLIC_KEY);

    expect(result).toBe(false);
  });

  it("rejects license verified with different public key", () => {
    const signedLicense = parseLicenseKey(VALID_LICENSE_KEY);

    expect(signedLicense).not.toBeNull();
    if (!signedLicense) throw new Error("Expected signedLicense to be defined");
    const result = verifySignature(signedLicense, WRONG_PUBLIC_KEY);

    expect(result).toBe(false);
  });

  it("rejects license with empty signature", () => {
    const signedLicense = parseLicenseKey(EMPTY_SIGNATURE_KEY);

    expect(signedLicense).not.toBeNull();
    if (!signedLicense) throw new Error("Expected signedLicense to be defined");
    const result = verifySignature(signedLicense, TEST_PUBLIC_KEY);

    expect(result).toBe(false);
  });
});

describe("isExpired", () => {
  it("returns false when expiration is in the future", () => {
    const futureDate = "2030-12-31T23:59:59Z";

    const result = isExpired(futureDate);

    expect(result).toBe(false);
  });

  it("returns true when expiration is in the past", () => {
    const pastDate = "2020-01-01T00:00:00Z";

    const result = isExpired(pastDate);

    expect(result).toBe(true);
  });

  it("returns true at exactly the expiration time", () => {
    const now = new Date("2024-06-15T12:00:00Z");
    const expiresAt = "2024-06-15T12:00:00Z";

    const result = isExpired(expiresAt, now);

    expect(result).toBe(true);
  });

  it("returns false one millisecond before expiration", () => {
    const now = new Date("2024-06-15T11:59:59.999Z");
    const expiresAt = "2024-06-15T12:00:00Z";

    const result = isExpired(expiresAt, now);

    expect(result).toBe(false);
  });

  it("returns true for invalid date string (security fallback)", () => {
    const result = isExpired("not-a-valid-date");

    expect(result).toBe(true);
  });
});

describe("validateLicense", () => {
  it("validates complete license successfully", () => {
    const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.planInfo.maxMembers).toBe(BASE_LICENSE.plan.maxMembers);
    }
  });

  it("fails validation for invalid format", () => {
    const result = validateLicense(GARBAGE_DATA, TEST_PUBLIC_KEY);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid license format");
    }
  });

  it("fails validation for invalid signature", () => {
    const result = validateLicense(TAMPERED_LICENSE_KEY, TEST_PUBLIC_KEY);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid signature");
    }
  });

  it("fails validation for expired license", () => {
    const result = validateLicense(EXPIRED_LICENSE_KEY, TEST_PUBLIC_KEY);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("License expired");
    }
  });

  describe("extracts license fields correctly", () => {
    it("extracts licenseId", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.licenseId).toBe(BASE_LICENSE.licenseId);
      }
    });

    it("extracts organizationName", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.organizationName).toBe(BASE_LICENSE.organizationName);
      }
    });

    it("extracts email", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.email).toBe(BASE_LICENSE.email);
      }
    });

    it("extracts plan.type", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.plan.type).toBe(BASE_LICENSE.plan.type);
      }
    });

    it("extracts plan.maxMembers", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.plan.maxMembers).toBe(BASE_LICENSE.plan.maxMembers);
      }
    });

    it("extracts plan.maxProjects", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.plan.maxProjects).toBe(BASE_LICENSE.plan.maxProjects);
      }
    });

    it("extracts plan.maxMessagesPerMonth", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.plan.maxMessagesPerMonth).toBe(BASE_LICENSE.plan.maxMessagesPerMonth);
      }
    });

    it("extracts plan.evaluationsCredit", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.plan.evaluationsCredit).toBe(BASE_LICENSE.plan.evaluationsCredit);
      }
    });

    it("extracts plan.maxWorkflows", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.plan.maxWorkflows).toBe(BASE_LICENSE.plan.maxWorkflows);
      }
    });

    it("extracts plan.canPublish", () => {
      const result = validateLicense(VALID_LICENSE_KEY, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.plan.canPublish).toBe(BASE_LICENSE.plan.canPublish);
      }
    });
  });
});

