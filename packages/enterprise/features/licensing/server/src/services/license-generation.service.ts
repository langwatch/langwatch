import {
  LicenseGenerationCapability,
  buildMintedPlan,
  getPlanTemplate,
  type GenerateLicenseInput,
  type GenerateLicenseOutput,
  type LicenseData,
} from "@langwatch/enterprise-licensing-contract";
import type { LicenseCryptographyPort } from "../ports/license-cryptography.port";

/**
 * Generates a signed, encoded license key.
 *
 * Pure business logic — no HTTP, no Prisma, no env var access.
 * Private key and all parameters passed explicitly.
 */
export class LicenseGenerationService extends LicenseGenerationCapability {
  private constructor(private readonly cryptography: LicenseCryptographyPort) {
    super();
  }

  static create(
    cryptography: LicenseCryptographyPort,
  ): LicenseGenerationService {
    return new LicenseGenerationService(cryptography);
  }

  generate({
    organizationName,
    email,
    planType,
    maxMembers,
    maxMembersLite,
    maxMessagesPerMonth,
    expiresAt: requestedExpiresAt,
    privateKey,
    now = new Date(),
  }: GenerateLicenseInput): GenerateLicenseOutput {
    const template = getPlanTemplate(planType);
    if (!template) throw new Error(`Unknown plan type: ${planType}`);

    const seats = maxMembers > 0 ? maxMembers : 1;
    const oneYearOut = new Date(now);
    oneYearOut.setFullYear(oneYearOut.getFullYear() + 1);
    const expiresAt = requestedExpiresAt ?? oneYearOut;
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error("Expiration date is not a date");
    }
    if (expiresAt <= now) {
      throw new Error("Expiration date must be in the future");
    }

    const licenseData: LicenseData = {
      licenseId: this.cryptography.generateLicenseId(),
      version: 1,
      organizationName: organizationName.trim() || email,
      email,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      plan: buildMintedPlan({
        type: template.type,
        name: template.name,
        maxMembers: seats,
        maxMembersLite: maxMembersLite ?? template.maxMembersLite,
        maxMessagesPerMonth:
          maxMessagesPerMonth ?? template.maxMessagesPerMonth,
        canPublish: template.canPublish,
        webhookEndpointsEnabled: template.webhookEndpointsEnabled,
        usageUnit: template.usageUnit,
      }),
    };
    const signedLicense = this.cryptography.signLicense(
      licenseData,
      privateKey,
    );
    return {
      licenseKey: this.cryptography.encodeLicenseKey(signedLicense),
      licenseData,
    };
  }
}
