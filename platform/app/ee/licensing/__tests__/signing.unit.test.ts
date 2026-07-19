import { describe, expect, it } from "vitest";
import {
  signLicense,
  encodeLicenseKey,
  generateLicenseId,
} from "../signing";
import { parseLicenseKey, verifySignature } from "../validation";
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY } from "./fixtures/testKeys";
import type { LicenseData } from "../types";

const createTestLicenseData = (overrides: Partial<LicenseData> = {}): LicenseData => ({
  licenseId: "test-lic-001",
  version: 1,
  organizationName: "Test Org",
  email: "test@test.com",
  issuedAt: "2024-01-01T00:00:00Z",
  expiresAt: "2030-12-31T23:59:59Z",
  plan: {
    type: "PRO",
    name: "Pro",
    maxMembers: 10,
    maxProjects: 20,
    maxMessagesPerMonth: 100000,
    evaluationsCredit: 500,
    maxWorkflows: 50,
    maxPrompts: 50,
    maxEvaluators: 50,
    maxScenarios: 50,
    canPublish: true,
  },
  ...overrides,
});

describe("signLicense", () => {
  it("creates RSA-SHA256 signature from license data", () => {
    const licenseData = createTestLicenseData();

    const signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);

    expect(signedLicense.data).toEqual(licenseData);
    expect(signedLicense.signature).toBeDefined();
    expect(typeof signedLicense.signature).toBe("string");
    expect(signedLicense.signature.length).toBeGreaterThan(0);
  });

  it("produces valid signature that can be verified with public key", () => {
    const licenseData = createTestLicenseData();

    const signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);
    const isValid = verifySignature(signedLicense, TEST_PUBLIC_KEY);

    expect(isValid).toBe(true);
  });

  it("produces different signatures for different license data", () => {
    const licenseData1 = createTestLicenseData({ organizationName: "Org A" });
    const licenseData2 = createTestLicenseData({ organizationName: "Org B" });

    const signed1 = signLicense(licenseData1, TEST_PRIVATE_KEY);
    const signed2 = signLicense(licenseData2, TEST_PRIVATE_KEY);

    expect(signed1.signature).not.toBe(signed2.signature);
  });

  it("produces consistent signatures for same license data", () => {
    const licenseData = createTestLicenseData();

    const signed1 = signLicense(licenseData, TEST_PRIVATE_KEY);
    const signed2 = signLicense(licenseData, TEST_PRIVATE_KEY);

    expect(signed1.signature).toBe(signed2.signature);
  });

  it("throws error for invalid private key", () => {
    const licenseData = createTestLicenseData();
    const invalidKey = "not-a-valid-key";

    expect(() => signLicense(licenseData, invalidKey)).toThrow();
  });
});

describe("encodeLicenseKey", () => {
  it("produces valid base64 string", () => {
    const licenseData = createTestLicenseData();
    const signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);

    const encodedKey = encodeLicenseKey(signedLicense);

    expect(typeof encodedKey).toBe("string");
    // Valid base64 should only contain alphanumeric, +, /, and =
    expect(encodedKey).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it("produces decodable JSON with data and signature fields", () => {
    const licenseData = createTestLicenseData();
    const signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);

    const encodedKey = encodeLicenseKey(signedLicense);
    const decoded = Buffer.from(encodedKey, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);

    expect(parsed).toHaveProperty("data");
    expect(parsed).toHaveProperty("signature");
    expect(parsed.data).toEqual(licenseData);
    expect(parsed.signature).toBe(signedLicense.signature);
  });

  it("produces key that can be parsed by parseLicenseKey", () => {
    const licenseData = createTestLicenseData();
    const signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);

    const encodedKey = encodeLicenseKey(signedLicense);
    const parsedLicense = parseLicenseKey(encodedKey);

    expect(parsedLicense).not.toBeNull();
    expect(parsedLicense?.data).toEqual(licenseData);
    expect(parsedLicense?.signature).toBe(signedLicense.signature);
  });

  it("produces key that validates successfully", () => {
    const licenseData = createTestLicenseData();
    const signedLicense = signLicense(licenseData, TEST_PRIVATE_KEY);

    const encodedKey = encodeLicenseKey(signedLicense);
    const parsedLicense = parseLicenseKey(encodedKey);

    expect(parsedLicense).not.toBeNull();
    if (parsedLicense) {
      const isValid = verifySignature(parsedLicense, TEST_PUBLIC_KEY);
      expect(isValid).toBe(true);
    }
  });
});

describe("generateLicenseId", () => {
  it("produces unique IDs", () => {
    const id1 = generateLicenseId();
    const id2 = generateLicenseId();

    expect(id1).not.toBe(id2);
  });

  it("produces IDs starting with lic- prefix", () => {
    const id = generateLicenseId();

    expect(id).toMatch(/^lic-/);
  });

  it("produces IDs of consistent format", () => {
    const id = generateLicenseId();

    // Format: lic-{uuid} or similar unique identifier
    expect(id.length).toBeGreaterThan(4); // "lic-" + at least 1 character
  });

  it("produces 100 unique IDs without collision", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateLicenseId());
    }

    expect(ids.size).toBe(100);
  });
});
