import {
  generateExpiredTestLicense,
  generateLicenseWithEmptySignature,
  generateTamperedTestLicense,
  generateTestLicense,
} from "./generateTestLicense";

/**
 * Pre-generated test licenses for use in tests.
 * Using factory functions to ensure fresh licenses with current timestamps.
 */

/** Valid PRO license expiring in 1 year */
export const createValidProLicense = () =>
  generateTestLicense({
    licenseId: "lic-pro-001",
    organizationName: "Pro Test Org",
    email: "pro@test.com",
    plan: {
      type: "PRO",
      name: "Pro",
      maxMembers: 10,
      maxProjects: 99,
      maxMessagesPerMonth: 100_000,
      evaluationsCredit: 100,
      maxWorkflows: 50,
      canPublish: true,
    },
  });

/** Valid GROWTH license with higher limits */
export const createValidGrowthLicense = () =>
  generateTestLicense({
    licenseId: "lic-growth-001",
    organizationName: "Growth Test Org",
    email: "growth@test.com",
    plan: {
      type: "GROWTH",
      name: "Growth",
      maxMembers: 25,
      maxProjects: 50,
      maxMessagesPerMonth: 500_000,
      evaluationsCredit: 250,
      maxWorkflows: 100,
      canPublish: true,
    },
  });

/** Valid ENTERPRISE license with maximum limits */
export const createValidEnterpriseLicense = () =>
  generateTestLicense({
    licenseId: "lic-enterprise-001",
    organizationName: "Enterprise Test Org",
    email: "enterprise@test.com",
    plan: {
      type: "ENTERPRISE",
      name: "Enterprise",
      maxMembers: 1000,
      maxProjects: 500,
      maxMessagesPerMonth: 10_000_000,
      evaluationsCredit: 10000,
      maxWorkflows: 1000,
      canPublish: true,
    },
  });

/** Expired license (expired yesterday) */
export const createExpiredLicense = () =>
  generateExpiredTestLicense({
    licenseId: "lic-expired-001",
    organizationName: "Expired Test Org",
    email: "expired@test.com",
  });

/** License with tampered data (signature doesn't match) */
export const createTamperedLicense = () =>
  generateTamperedTestLicense({
    licenseId: "lic-tampered-001",
    organizationName: "Tampered Test Org",
    email: "tampered@test.com",
  });

/** License with empty signature */
export const createLicenseWithEmptySignature = () =>
  generateLicenseWithEmptySignature({
    licenseId: "lic-nosig-001",
    organizationName: "No Signature Test Org",
    email: "nosig@test.com",
  });

/** License with minimal limits (similar to FREE tier) */
export const createMinimalLicense = () =>
  generateTestLicense({
    licenseId: "lic-minimal-001",
    organizationName: "Minimal Test Org",
    email: "minimal@test.com",
    plan: {
      type: "STARTER",
      name: "Starter",
      maxMembers: 3,
      maxProjects: 3,
      maxMessagesPerMonth: 5_000,
      evaluationsCredit: 10,
      maxWorkflows: 5,
      canPublish: false,
    },
  });

/** License expiring soon (7 days) */
export const createExpiringSoonLicense = () =>
  generateTestLicense({
    licenseId: "lic-expiring-001",
    organizationName: "Expiring Soon Test Org",
    email: "expiring@test.com",
    expiresAt: new Date(
      Date.now() + 7 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  });
