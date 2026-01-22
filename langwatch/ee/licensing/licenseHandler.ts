import type { PrismaClient } from "@prisma/client";
import type { PlanInfo } from "~/server/subscriptionHandler";
import { FREE_PLAN, PUBLIC_KEY, UNLIMITED_PLAN } from "./constants";
import { mapToPlanInfo } from "./planMapping";
import type { LicenseStatus, StoreLicenseResult } from "./types";
import { validateLicense, parseLicenseKey } from "./validation";

interface LicenseHandlerConfig {
  prisma: PrismaClient;
  licenseEnforcementEnabled?: boolean;
  publicKey?: string;
}

/**
 * Manages license validation and storage for self-hosted deployments.
 *
 * Key behaviors:
 * - No license = UNLIMITED_PLAN (backward compatible with current OSS behavior)
 * - Valid license = license-based limits
 * - Invalid/expired license = FREE_PLAN (restricted fallback)
 * - LICENSE_ENFORCEMENT_ENABLED=false = UNLIMITED_PLAN regardless of license
 */
export class LicenseHandler {
  private prisma: PrismaClient;
  private licenseEnforcementEnabled: boolean;
  private publicKey: string;

  constructor(config: LicenseHandlerConfig) {
    this.prisma = config.prisma;
    this.licenseEnforcementEnabled = config.licenseEnforcementEnabled ?? false;
    this.publicKey = config.publicKey ?? PUBLIC_KEY;
  }

  /**
   * Gets the active plan for an organization based on its stored license.
   *
   * Returns:
   * - UNLIMITED_PLAN if license enforcement is disabled
   * - UNLIMITED_PLAN if no license is stored (backward compatible)
   * - License-based PlanInfo if valid license exists
   * - FREE_PLAN if license is invalid or expired
   */
  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    // If enforcement is disabled, always return unlimited
    if (!this.licenseEnforcementEnabled) {
      return UNLIMITED_PLAN;
    }

    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { license: true },
    });

    // No license stored = unlimited (backward compatible)
    if (!organization?.license) {
      return UNLIMITED_PLAN;
    }

    // Validate the stored license
    const result = validateLicense(organization.license, this.publicKey);

    if (result.valid) {
      return result.planInfo;
    }

    // Invalid or expired license = restricted FREE_PLAN
    return FREE_PLAN;
  }

  /**
   * Stores a license for an organization after validation.
   *
   * - Validates the license key format, signature, and expiry
   * - Updates the organization with license data
   * - Returns the resulting plan info on success
   */
  async storeLicense(
    organizationId: string,
    licenseKey: string
  ): Promise<StoreLicenseResult> {
    // Validate the license before storing
    const result = validateLicense(licenseKey, this.publicKey);

    if (!result.valid) {
      return {
        success: false,
        error: result.error,
      };
    }

    const { licenseData, planInfo } = result;

    // Store the license and metadata
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: licenseKey,
        licenseExpiresAt: new Date(licenseData.expiresAt),
        licenseLastValidatedAt: new Date(),
      },
    });

    return {
      success: true,
      planInfo,
    };
  }

  /**
   * Gets the current license status for an organization.
   *
   * Returns details about whether a license exists, its validity,
   * plan type, and expiration date.
   */
  async getLicenseStatus(organizationId: string): Promise<LicenseStatus> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        license: true,
        licenseExpiresAt: true,
        _count: {
          select: { members: true },
        },
      },
    });

    if (!organization?.license) {
      return {
        hasLicense: false,
        valid: false,
      };
    }

    // Parse the license to get plan info even if expired
    const parsed = parseLicenseKey(organization.license);
    const result = validateLicense(organization.license, this.publicKey);

    if (!parsed) {
      return {
        hasLicense: true,
        valid: false,
      };
    }

    const { data: licenseData } = parsed;

    return {
      hasLicense: true,
      valid: result.valid,
      plan: licenseData.plan.type,
      planName: licenseData.plan.name,
      expiresAt: licenseData.expiresAt,
      organizationName: licenseData.organizationName,
      currentMembers: organization._count.members,
      maxMembers: licenseData.plan.maxMembers,
    };
  }

  /**
   * Removes the license from an organization.
   *
   * This clears all license-related fields, returning the organization
   * to unlimited mode (no enforcement).
   */
  async removeLicense(organizationId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });
  }
}
