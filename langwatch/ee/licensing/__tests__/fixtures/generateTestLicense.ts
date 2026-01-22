import crypto from "crypto";
import type { LicenseData, LicensePlanLimits, SignedLicense } from "../../types";
import { TEST_PRIVATE_KEY } from "./testKeys";

/**
 * Default plan limits for test licenses
 */
export const DEFAULT_TEST_PLAN: LicensePlanLimits = {
  type: "PRO",
  name: "Pro",
  maxMembers: 10,
  maxProjects: 99,
  maxMessagesPerMonth: 100_000,
  evaluationsCredit: 100,
  maxWorkflows: 50,
  canPublish: true,
};

/**
 * Options for generating a test license
 */
export interface GenerateTestLicenseOptions {
  licenseId?: string;
  version?: number;
  organizationName?: string;
  email?: string;
  issuedAt?: string;
  expiresAt?: string;
  plan?: Partial<LicensePlanLimits>;
}

/**
 * Generates a signed test license with the test private key.
 *
 * @param options - Options to customize the license
 * @returns Base64-encoded signed license string
 */
export function generateTestLicense(
  options: GenerateTestLicenseOptions = {},
): string {
  const licenseData: LicenseData = {
    licenseId: options.licenseId ?? `lic-test-${Date.now()}`,
    version: options.version ?? 1,
    organizationName: options.organizationName ?? "Test Organization",
    email: options.email ?? "test@example.com",
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    expiresAt:
      options.expiresAt ??
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year from now
    plan: {
      ...DEFAULT_TEST_PLAN,
      ...options.plan,
    },
  };

  const signedLicense = signLicenseData(licenseData, TEST_PRIVATE_KEY);
  return Buffer.from(JSON.stringify(signedLicense)).toString("base64");
}

/**
 * Signs license data with the provided private key.
 *
 * @param data - The license data to sign
 * @param privateKey - RSA private key in PEM format
 * @returns SignedLicense with data and signature
 */
export function signLicenseData(
  data: LicenseData,
  privateKey: string,
): SignedLicense {
  const dataString = JSON.stringify(data);
  const sign = crypto.createSign("SHA256");
  sign.update(dataString);
  sign.end();
  const signature = sign.sign(privateKey, "base64");

  return {
    data,
    signature,
  };
}

/**
 * Generates an expired test license.
 */
export function generateExpiredTestLicense(
  options: Omit<GenerateTestLicenseOptions, "expiresAt"> = {},
): string {
  return generateTestLicense({
    ...options,
    expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // Yesterday
  });
}

/**
 * Generates a test license with tampered data (invalid signature).
 */
export function generateTamperedTestLicense(
  options: GenerateTestLicenseOptions = {},
): string {
  // Generate a valid license
  const validLicense = generateTestLicense(options);

  // Decode, modify, and re-encode without re-signing
  const decoded = JSON.parse(
    Buffer.from(validLicense, "base64").toString("utf-8"),
  ) as SignedLicense;

  // Tamper with the data
  decoded.data.plan.maxMembers = 999999;

  // Re-encode without updating signature
  return Buffer.from(JSON.stringify(decoded)).toString("base64");
}

/**
 * Generates a license with an empty signature.
 */
export function generateLicenseWithEmptySignature(
  options: GenerateTestLicenseOptions = {},
): string {
  const licenseData: LicenseData = {
    licenseId: options.licenseId ?? `lic-test-${Date.now()}`,
    version: options.version ?? 1,
    organizationName: options.organizationName ?? "Test Organization",
    email: options.email ?? "test@example.com",
    issuedAt: options.issuedAt ?? new Date().toISOString(),
    expiresAt:
      options.expiresAt ??
      new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    plan: {
      ...DEFAULT_TEST_PLAN,
      ...options.plan,
    },
  };

  const signedLicense: SignedLicense = {
    data: licenseData,
    signature: "", // Empty signature
  };

  return Buffer.from(JSON.stringify(signedLicense)).toString("base64");
}
