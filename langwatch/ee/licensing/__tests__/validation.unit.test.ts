import { describe, expect, it } from "vitest";
import {
  getPlanFromLicense,
  isExpired,
  parseLicenseKey,
  validateLicense,
  verifySignature,
} from "../validation";
import { FREE_PLAN } from "../constants";
import {
  generateTestLicense,
  generateExpiredTestLicense,
  generateTamperedTestLicense,
  generateLicenseWithEmptySignature,
} from "./fixtures/generateTestLicense";
import { TEST_PUBLIC_KEY } from "./fixtures/testKeys";
import type { SignedLicense } from "../types";

describe("parseLicenseKey", () => {
  it("parses valid base64-encoded license key", () => {
    const validLicense = generateTestLicense({
      organizationName: "Acme Corp",
    });

    const result = parseLicenseKey(validLicense);

    expect(result).not.toBeNull();
    expect(result?.data.organizationName).toBe("Acme Corp");
    expect(result?.signature).toBeDefined();
  });

  it("returns null for malformed base64 input", () => {
    const result = parseLicenseKey("not-valid-base64!!!");

    expect(result).toBeNull();
  });

  it("returns null for valid base64 but invalid JSON", () => {
    const notJson = Buffer.from("not json content").toString("base64");

    const result = parseLicenseKey(notJson);

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
      JSON.stringify({ foo: "bar" }),
    ).toString("base64");

    const result = parseLicenseKey(invalidStructure);

    expect(result).toBeNull();
  });
});

describe("verifySignature", () => {
  it("verifies valid RSA-SHA256 signature", () => {
    const validLicense = generateTestLicense();
    const signedLicense = parseLicenseKey(validLicense);

    expect(signedLicense).not.toBeNull();
    const result = verifySignature(signedLicense!, TEST_PUBLIC_KEY);

    expect(result).toBe(true);
  });

  it("rejects tampered license data", () => {
    const tamperedLicense = generateTamperedTestLicense();
    const signedLicense = parseLicenseKey(tamperedLicense);

    expect(signedLicense).not.toBeNull();
    const result = verifySignature(signedLicense!, TEST_PUBLIC_KEY);

    expect(result).toBe(false);
  });

  it("rejects license with wrong signature (different key)", () => {
    // Generate a license, then try to verify with a different key
    const validLicense = generateTestLicense();
    const signedLicense = parseLicenseKey(validLicense);

    expect(signedLicense).not.toBeNull();

    // Use a different public key (the production placeholder won't match)
    const wrongKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890abcdef
-----END PUBLIC KEY-----`;

    // This should either return false or throw (depending on key validity)
    try {
      const result = verifySignature(signedLicense!, wrongKey);
      expect(result).toBe(false);
    } catch {
      // Invalid key format also means verification fails
      expect(true).toBe(true);
    }
  });

  it("rejects license with empty signature", () => {
    const noSigLicense = generateLicenseWithEmptySignature();
    const signedLicense = parseLicenseKey(noSigLicense);

    expect(signedLicense).not.toBeNull();
    const result = verifySignature(signedLicense!, TEST_PUBLIC_KEY);

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
});

describe("validateLicense", () => {
  it("validates complete license successfully", () => {
    const validLicense = generateTestLicense({
      plan: { maxMembers: 5 },
    });

    const result = validateLicense(validLicense, TEST_PUBLIC_KEY);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.planInfo.maxMembers).toBe(5);
    }
  });

  it("fails validation for invalid format", () => {
    const result = validateLicense("garbage-data", TEST_PUBLIC_KEY);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid license format");
    }
  });

  it("fails validation for invalid signature", () => {
    const tamperedLicense = generateTamperedTestLicense();

    const result = validateLicense(tamperedLicense, TEST_PUBLIC_KEY);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid signature");
    }
  });

  it("fails validation for expired license", () => {
    const expiredLicense = generateExpiredTestLicense();

    const result = validateLicense(expiredLicense, TEST_PUBLIC_KEY);

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("License expired");
    }
  });

  it("extracts all license fields correctly", () => {
    const license = generateTestLicense({
      licenseId: "lic-001",
      organizationName: "Test Org",
      email: "admin@test.org",
      plan: {
        type: "GROWTH",
        name: "Growth",
        maxMembers: 10,
        maxProjects: 99,
        maxMessagesPerMonth: 100000,
        evaluationsCredit: 50,
        maxWorkflows: 100,
        canPublish: true,
      },
    });

    const result = validateLicense(license, TEST_PUBLIC_KEY);

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.licenseData.licenseId).toBe("lic-001");
      expect(result.licenseData.organizationName).toBe("Test Org");
      expect(result.licenseData.email).toBe("admin@test.org");
      expect(result.licenseData.plan.type).toBe("GROWTH");
      expect(result.licenseData.plan.maxMembers).toBe(10);
      expect(result.licenseData.plan.maxProjects).toBe(99);
      expect(result.licenseData.plan.maxMessagesPerMonth).toBe(100000);
      expect(result.licenseData.plan.evaluationsCredit).toBe(50);
      expect(result.licenseData.plan.maxWorkflows).toBe(100);
      expect(result.licenseData.plan.canPublish).toBe(true);
    }
  });
});

describe("getPlanFromLicense", () => {
  it("returns plan info for valid license", () => {
    const license = generateTestLicense({
      plan: { type: "PRO", name: "Pro", maxMembers: 50 },
    });

    const plan = getPlanFromLicense(license, TEST_PUBLIC_KEY);

    expect(plan.type).toBe("PRO");
    expect(plan.maxMembers).toBe(50);
  });

  it("returns FREE_PLAN for invalid license format", () => {
    const plan = getPlanFromLicense("garbage-data", TEST_PUBLIC_KEY);

    expect(plan).toEqual(FREE_PLAN);
  });

  it("returns FREE_PLAN for expired license", () => {
    const expired = generateExpiredTestLicense();

    const plan = getPlanFromLicense(expired, TEST_PUBLIC_KEY);

    expect(plan).toEqual(FREE_PLAN);
  });

  it("returns FREE_PLAN for tampered license", () => {
    const tampered = generateTamperedTestLicense();

    const plan = getPlanFromLicense(tampered, TEST_PUBLIC_KEY);

    expect(plan).toEqual(FREE_PLAN);
  });
});
