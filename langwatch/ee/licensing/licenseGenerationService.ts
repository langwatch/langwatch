import type { LicenseData } from "./types";
import { signLicense, encodeLicenseKey, generateLicenseId } from "./signing";
import { getPlanTemplate } from "./planTemplates";

interface GenerateLicenseKeyParams {
  organizationName: string;
  email: string;
  planType: string;
  maxMembers: number;
  privateKey: string;
  /**
   * Marks the license as a trial (ADR-039 Decision 8): trial licenses are
   * auto-cleared when a Stripe subscription activates; non-trial licenses
   * never are. Omitted (not stamped) for purchased licenses.
   */
  isTrial?: boolean;
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
  isTrial,
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

  // Build plan with keys matching Zod schema field order.
  // Signature verification re-serializes via JSON.stringify after Zod parsing,
  // which reorders keys to schema order. Key order must match at sign time.
  const plan: LicenseData["plan"] = {
    type: template.type,
    name: template.name,
    maxMembers: seats,
    maxMembersLite: template.maxMembersLite,
    maxTeams: template.maxTeams,
    maxProjects: template.maxProjects,
    maxMessagesPerMonth: template.maxMessagesPerMonth,
    evaluationsCredit: template.evaluationsCredit ?? 0,
    maxWorkflows: template.maxWorkflows,
    maxPrompts: template.maxPrompts,
    maxEvaluators: template.maxEvaluators,
    maxScenarios: template.maxScenarios,
    maxAgents: template.maxAgents,
    maxExperiments: template.maxExperiments,
    maxOnlineEvaluations: template.maxOnlineEvaluations,
    maxDatasets: template.maxDatasets,
    maxDashboards: template.maxDashboards,
    maxCustomGraphs: template.maxCustomGraphs,
    maxAutomations: template.maxAutomations,
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
    // Only stamped when explicitly set — absent means non-trial, and key
    // order must stay stable for signature re-serialization.
    ...(isTrial !== undefined && { isTrial }),
  };

  const signedLicense = signLicense(licenseData, privateKey);
  const licenseKey = encodeLicenseKey(signedLicense);

  return { licenseKey, licenseData };
}
