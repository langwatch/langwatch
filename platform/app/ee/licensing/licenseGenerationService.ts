import { buildMintedPlan } from "./mintedPlan";
import { getPlanTemplate } from "./planTemplates";
import { encodeLicenseKey, generateLicenseId, signLicense } from "./signing";
import type { LicenseData } from "./types";

interface GenerateLicenseKeyParams {
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  privateKey: string;
  /**
   * The numbers a negotiated contract sets, where they differ from the plan
   * template. Left off, the template's value is minted. These exist because
   * the template is a starting point, not the contract: minting a template
   * number over an agreed one silently cuts what the customer bought, and a
   * signed license is the enforcement.
   */
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  /** Defaults to one year from `now`. */
  expiresAt?: Date;
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
  maxMembersLite,
  maxMessagesPerMonth,
  expiresAt: requestedExpiresAt,
  privateKey,
  now = new Date(),
}: GenerateLicenseKeyParams): GenerateLicenseKeyResult {
  const template = getPlanTemplate(planType);
  if (!template) {
    throw new Error(`Unknown plan type: ${planType}`);
  }

  const seats = maxMembers > 0 ? maxMembers : 1;

  const oneYearOut = new Date(now);
  oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);
  const expiresAt = requestedExpiresAt ?? oneYearOut;
  // An unparseable date compares false against everything, so it would slip
  // past the expiry check below and only fail further down, as a RangeError
  // out of toISOString that names nothing.
  if (Number.isNaN(expiresAt.getTime())) {
    throw new Error("Expiration date is not a date");
  }
  // Same refusal the license router makes: an already-expired license reads as
  // no license at all, which on Cloud silently drops the org onto whatever
  // sits underneath it.
  if (expiresAt <= now) {
    throw new Error("Expiration date must be in the future");
  }

  const resolvedOrgName = organizationName.trim() || email;

  // Licenses encode only the enforced levers (member seats, messages volume)
  // plus identity, and the retired fields older deployments still require.
  // See `buildMintedPlan` for both constraints.
  const plan: LicenseData["plan"] = buildMintedPlan({
    type: template.type,
    name: template.name,
    maxMembers: seats,
    maxMembersLite: maxMembersLite ?? template.maxMembersLite,
    maxMessagesPerMonth: maxMessagesPerMonth ?? template.maxMessagesPerMonth,
    canPublish: template.canPublish,
    webhookEndpointsEnabled: template.webhookEndpointsEnabled,
    usageUnit: template.usageUnit,
  });

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
