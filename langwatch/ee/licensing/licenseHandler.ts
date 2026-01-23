import type { PrismaClient } from "@prisma/client";
import type { PlanInfo } from "~/server/subscriptionHandler";
import { FREE_PLAN, PUBLIC_KEY } from "./constants";
import { OrganizationNotFoundError } from "./errors";
import type { LicenseStatus, RemoveLicenseResult, StoreLicenseResult } from "./types";
import { validateLicense, parseLicenseKey } from "./validation";

interface LicenseHandlerConfig {
  prisma: PrismaClient;
  publicKey?: string;
}

/**
 * Manages license validation and storage for self-hosted deployments.
 *
 * This handler is only called when LICENSE_ENFORCEMENT_ENABLED=true.
 * When enforcement is disabled, SubscriptionHandler returns UNLIMITED_PLAN directly.
 *
 * Key behaviors (when enforcement is enabled):
 * - No license stored = FREE_PLAN (restricted access)
 * - Valid license = license-based limits
 * - Invalid/expired license = FREE_PLAN (restricted fallback)
 */
export class LicenseHandler {
  private prisma: PrismaClient;
  private publicKey: string;

  constructor(config: LicenseHandlerConfig) {
    this.prisma = config.prisma;
    this.publicKey = config.publicKey ?? PUBLIC_KEY;
  }

  /**
   * Factory method for creating a LicenseHandler instance.
   * Provides proper lifecycle management for production use.
   */
  static create(prisma: PrismaClient, publicKey?: string): LicenseHandler {
    return new LicenseHandler({ prisma, publicKey });
  }

  /**
   * Gets the active plan for an organization based on its stored license.
   *
   * Returns:
   * - FREE_PLAN if no license is stored
   * - License-based PlanInfo if valid license exists
   * - FREE_PLAN if license is invalid or expired
   */
  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { license: true },
    });

    // No license stored = FREE_PLAN (enforcement enabled requires valid license)
    if (!organization?.license) {
      return FREE_PLAN;
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
   * Validates and stores a license for an organization.
   *
   * - Validates the license key format, signature, and expiry
   * - Updates the organization with license data
   * - Returns the resulting plan info on success
   */
  async validateAndStoreLicense(
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

    // Verify organization exists
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!org) {
      throw new OrganizationNotFoundError();
    }

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
   * plan type, and expiration date. Metadata is returned even for
   * invalid licenses so the UI can display "license expired" messages.
   */
  async getLicenseStatus(organizationId: string): Promise<LicenseStatus> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: {
        license: true,
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

    // Parse license to get metadata (needed even if invalid)
    const signedLicense = parseLicenseKey(organization.license);

    if (!signedLicense) {
      // License exists but is corrupted/unreadable
      return {
        hasLicense: true,
        valid: false,
        corrupted: true,
      };
    }

    // Use validateLicense for validity check (DRY - avoids duplicate verifySignature/isExpired)
    const validationResult = validateLicense(organization.license, this.publicKey);

    // Return metadata regardless of validity - UI needs this for "license expired" messages
    const { data: licenseData } = signedLicense;

    if (validationResult.valid) {
      return {
        hasLicense: true,
        valid: true,
        plan: licenseData.plan.type,
        planName: licenseData.plan.name,
        expiresAt: licenseData.expiresAt,
        organizationName: licenseData.organizationName,
        currentMembers: organization._count.members,
        maxMembers: licenseData.plan.maxMembers,
      };
    }

    return {
      hasLicense: true,
      valid: false,
      plan: licenseData.plan.type,
      planName: licenseData.plan.name,
      expiresAt: licenseData.expiresAt,
      organizationName: licenseData.organizationName,
      currentMembers: organization._count.members,
      maxMembers: licenseData.plan.maxMembers,
    };
  }

  /**
   * Removes the license from an organization (idempotent).
   *
   * This clears all license-related fields, returning the organization
   * to unlimited mode (when enforcement is disabled) or FREE_PLAN
   * (when enforcement is enabled).
   *
   * @returns { removed: true } if license was removed, { removed: false } if org not found
   */
  async removeLicense(organizationId: string): Promise<RemoveLicenseResult> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });

    if (!org) {
      throw new OrganizationNotFoundError();
    }

    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });

    return { removed: true };
  }
}
