import { describe, it, expect } from "vitest";
import { generateLicenseKey } from "../licenseGenerationService";
import { validateLicense } from "../validation";
import { TEST_PRIVATE_KEY, TEST_PUBLIC_KEY } from "./fixtures/testKeys";
import { DEFAULT_LIMIT } from "../constants";

const baseParams = {
  organizationName: "Acme Corp",
  email: "buyer@acme.com",
  planType: "GROWTH",
  maxMembers: 5,
  privateKey: TEST_PRIVATE_KEY,
  now: new Date("2025-06-15T12:00:00Z"),
};

describe("generateLicenseKey", () => {
  describe("when generating a GROWTH license", () => {
    it("generates a valid license key that passes round-trip validation", () => {
      const { licenseKey } = generateLicenseKey(baseParams);
      const result = validateLicense(licenseKey, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
    });

    it("sets maxMembers from the provided seat count", () => {
      const { licenseData } = generateLicenseKey(baseParams);

      expect(licenseData.plan.maxMembers).toBe(5);
    });

    it("sets all other limits to unlimited (DEFAULT_LIMIT)", () => {
      const { licenseData } = generateLicenseKey(baseParams);
      const { plan } = licenseData;

      expect(plan.maxMembersLite).toBe(DEFAULT_LIMIT);
      expect(plan.maxTeams).toBe(DEFAULT_LIMIT);
      expect(plan.maxProjects).toBe(DEFAULT_LIMIT);
      expect(plan.maxMessagesPerMonth).toBe(DEFAULT_LIMIT);
      expect(plan.evaluationsCredit).toBe(DEFAULT_LIMIT);
      expect(plan.maxWorkflows).toBe(DEFAULT_LIMIT);
      expect(plan.maxPrompts).toBe(DEFAULT_LIMIT);
      expect(plan.maxEvaluators).toBe(DEFAULT_LIMIT);
      expect(plan.maxScenarios).toBe(DEFAULT_LIMIT);
      expect(plan.maxAgents).toBe(DEFAULT_LIMIT);
      expect(plan.maxExperiments).toBe(DEFAULT_LIMIT);
      expect(plan.maxOnlineEvaluations).toBe(DEFAULT_LIMIT);
      expect(plan.maxDatasets).toBe(DEFAULT_LIMIT);
      expect(plan.maxDashboards).toBe(DEFAULT_LIMIT);
      expect(plan.maxCustomGraphs).toBe(DEFAULT_LIMIT);
      expect(plan.maxAutomations).toBe(DEFAULT_LIMIT);
    });

    it("sets plan type to GROWTH and name to Growth", () => {
      const { licenseData } = generateLicenseKey(baseParams);

      expect(licenseData.plan.type).toBe("GROWTH");
      expect(licenseData.plan.name).toBe("Growth");
    });

    it("sets canPublish to true and usageUnit to events", () => {
      const { licenseData } = generateLicenseKey(baseParams);

      expect(licenseData.plan.canPublish).toBe(true);
      expect(licenseData.plan.usageUnit).toBe("events");
    });
  });

  describe("when generating a PRO license", () => {
    it("generates a valid license with PRO template limits", () => {
      const { licenseKey, licenseData } = generateLicenseKey({
        ...baseParams,
        planType: "PRO",
        maxMembers: 10,
      });

      const result = validateLicense(licenseKey, TEST_PUBLIC_KEY);
      expect(result.valid).toBe(true);
      expect(licenseData.plan.type).toBe("PRO");
      expect(licenseData.plan.maxMembers).toBe(10);
      expect(licenseData.plan.maxProjects).toBe(20);
    });
  });

  describe("when generating an ENTERPRISE license", () => {
    it("generates a valid license with ENTERPRISE template limits", () => {
      const { licenseKey, licenseData } = generateLicenseKey({
        ...baseParams,
        planType: "ENTERPRISE",
        maxMembers: 50,
      });

      const result = validateLicense(licenseKey, TEST_PUBLIC_KEY);
      expect(result.valid).toBe(true);
      expect(licenseData.plan.type).toBe("ENTERPRISE");
      expect(licenseData.plan.maxMembers).toBe(50);
      expect(licenseData.plan.maxProjects).toBe(500);
    });
  });

  describe("when expiration is calculated", () => {
    it("expires exactly 1 year from the generation date", () => {
      const { licenseData } = generateLicenseKey(baseParams);

      expect(licenseData.expiresAt).toBe("2026-06-15T12:00:00.000Z");
    });

    it("handles leap year boundary correctly", () => {
      const { licenseData } = generateLicenseKey({
        ...baseParams,
        now: new Date("2024-02-29T12:00:00Z"),
      });

      // Feb 29 2024 + 1 year → Mar 1 2025 (no Feb 29 in 2025)
      expect(licenseData.expiresAt).toBe("2025-03-01T12:00:00.000Z");
    });
  });

  describe("when organization name is empty", () => {
    it("falls back to email as organization name", () => {
      const { licenseData } = generateLicenseKey({
        ...baseParams,
        organizationName: "",
      });

      expect(licenseData.organizationName).toBe("buyer@acme.com");
    });

    it("falls back to email when name is whitespace-only", () => {
      const { licenseData } = generateLicenseKey({
        ...baseParams,
        organizationName: "   ",
      });

      expect(licenseData.organizationName).toBe("buyer@acme.com");
    });
  });

  describe("when maxMembers is zero or negative", () => {
    it("defaults to 1 seat when maxMembers is 0", () => {
      const { licenseData } = generateLicenseKey({
        ...baseParams,
        maxMembers: 0,
      });

      expect(licenseData.plan.maxMembers).toBe(1);
    });

    it("defaults to 1 seat when maxMembers is negative", () => {
      const { licenseData } = generateLicenseKey({
        ...baseParams,
        maxMembers: -3,
      });

      expect(licenseData.plan.maxMembers).toBe(1);
    });
  });

  describe("when plan type is unknown", () => {
    it("throws an error for unknown plan types", () => {
      expect(() =>
        generateLicenseKey({
          ...baseParams,
          planType: "CUSTOM",
        })
      ).toThrow("Unknown plan type: CUSTOM");
    });
  });

  describe("when license metadata is set", () => {
    it("sets version to 1", () => {
      const { licenseData } = generateLicenseKey(baseParams);

      expect(licenseData.version).toBe(1);
    });

    it("sets issuedAt to the provided now date", () => {
      const { licenseData } = generateLicenseKey(baseParams);

      expect(licenseData.issuedAt).toBe("2025-06-15T12:00:00.000Z");
    });

    it("generates a unique licenseId with lic- prefix", () => {
      const { licenseData: first } = generateLicenseKey(baseParams);
      const { licenseData: second } = generateLicenseKey(baseParams);

      expect(first.licenseId).toMatch(/^lic-/);
      expect(second.licenseId).toMatch(/^lic-/);
      expect(first.licenseId).not.toBe(second.licenseId);
    });

    it("stores email and organization name in license data", () => {
      const { licenseData } = generateLicenseKey(baseParams);

      expect(licenseData.email).toBe("buyer@acme.com");
      expect(licenseData.organizationName).toBe("Acme Corp");
    });
  });

  describe("when validating round-trip integrity", () => {
    it("produces a license that can be parsed and verified", () => {
      const { licenseKey, licenseData } = generateLicenseKey(baseParams);
      const result = validateLicense(licenseKey, TEST_PUBLIC_KEY);

      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.licenseData.licenseId).toBe(licenseData.licenseId);
        expect(result.licenseData.email).toBe("buyer@acme.com");
        expect(result.licenseData.organizationName).toBe("Acme Corp");
        expect(result.licenseData.plan.type).toBe("GROWTH");
        expect(result.licenseData.plan.maxMembers).toBe(5);
      }
    });

    it("fails validation with a different public key", () => {
      const { licenseKey } = generateLicenseKey(baseParams);
      const result = validateLicense(
        licenseKey,
        // Use a dummy key that doesn't match
        `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAq4utbj0BDQlwUcQ2gNar
8vT0JYj24i6xoIGLBmwkY/D9vxU4FbFdiLPddiv+Mv5KAPVvNXbLy8zkbsK74BT7
ye7Od2bJILMiZGMRKj7t1lx3ClthIZKUWjGMiWY0FyOHon+vrz81QireVd1QQuYh
zLk5oLpttCXLIUqatQ+w6M9oHz8Ru+qy6thFEe29lqGCczRmpCtXmGr5R22UVUp7
OLqhJ/73aa+nso54jUvMTUYt8k0kbOhvSY9EhwrsvCxeJcNCl3vYf4Cphpqf9OF0
sUIBcjrzUh14Z/RxKyun5Ld12xGVuhSzVf0xnWar338N9WKgaFOW+zgRchBGdXFD
dQIDAQAB
-----END PUBLIC KEY-----`,
      );

      expect(result.valid).toBe(false);
    });
  });
});
