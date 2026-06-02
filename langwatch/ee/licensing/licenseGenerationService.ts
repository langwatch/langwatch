import type { LicenseData } from "./types";
import { signLicense, encodeLicenseKey, generateLicenseId } from "./signing";
import { getPlanTemplate } from "./planTemplates";

interface GenerateLicenseKeyParams {
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  privateKey: string;
  /** Override current time for deterministic testing */
  now?: Date;
}

interface GenerateLicenseKeyResult {
  licenseKey: string;
  licenseData: LicenseData;
}

/**
 * Generates a signed, encoded license key.
 *
 * Pure business logic — no HTTP, no Prisma, no env var access.
 * Private key and all parameters passed explicitly.
 */
export function generateLicenseKey({
  organizationName,
  email,
  planType,
  maxMembers,
  privateKey,
  now = new Date(),
}: GenerateLicenseKeyParams): GenerateLicenseKeyResult {
  const template = getPlanTemplate(planType);
  if (!template) {
    throw new Error(`Unknown plan type: ${planType}`);
  }

  const seats = maxMembers > 0 ? maxMembers : 1;

  const expiresAt = new Date(now);
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  const resolvedOrgName = organizationName.trim() || email;

  // Licenses encode only the enforced levers (member seats, messages volume)
  // plus identity. Keys MUST be listed in LicensePlanLimitsSchema field order:
  // signature verification re-serializes via JSON.stringify after Zod parsing,
  // which orders keys to schema order, so sign-time order must match.
  const plan: LicenseData["plan"] = {
    type: template.type,
    name: template.name,
    maxMembers: seats,
    maxMembersLite: template.maxMembersLite,
    maxMessagesPerMonth: template.maxMessagesPerMonth,
    canPublish: template.canPublish,
    usageUnit: template.usageUnit,
  };

  const licenseData: LicenseData = {
    licenseId: generateLicenseId(),
    version: 1,
    organizationName: resolvedOrgName,
    email,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    plan,
  };

  const signedLicense = signLicense(licenseData, privateKey);
  const licenseKey = encodeLicenseKey(signedLicense);

  return { licenseKey, licenseData };
}
