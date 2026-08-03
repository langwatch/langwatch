import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import type { ILicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";
import { USAGE_UNKNOWN, type UsageCount } from "~/server/traces/usage-count";
import { getApp } from "../../src/server/app-layer/app";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  RETENTION_CATEGORIES,
} from "../../src/server/data-retention/retentionPolicy.schema";
import { PUBLIC_KEY, UNLIMITED_PLAN } from "./constants";
import { resolvePlanDefaults } from "./defaults";
import { OrganizationNotFoundError } from "./errors";
import type { PlanInfo } from "./planInfo";
import { mapToPlanInfo } from "./planMapping";
import type {
  LicensePlanLimits,
  LicenseStatus,
  RemoveLicenseResult,
  StoreLicenseResult,
} from "./types";
import {
  isExpired,
  parseLicenseKey,
  validateLicense,
  verifySignature,
} from "./validation";

const logger = createLogger("langwatch:licensing:licenseHandler");

/**
 * Interface for trace usage counting.
 * Follows Interface Segregation Principle - only what we need.
 */
export interface ITraceUsageService {
  getCurrentMonthCount(params: {
    organizationId: string;
  }): Promise<UsageCount | "unlimited">;
}

interface LicenseHandlerConfig {
  prisma: PrismaClient;
  publicKey?: string;
  repository: ILicenseEnforcementRepository;
  traceUsageService?: ITraceUsageService;
}

/**
 * Manages license validation and storage for self-hosted deployments.
 *
 * Key behaviors:
 * - No license stored = UNLIMITED_PLAN (the OSS baseline)
 * - Valid license = license-based limits
 * - Unreadable or unsigned license = UNLIMITED_PLAN (the OSS baseline)
 * - License past its end date: depends on the caller. `getSelfHostedPlan` keeps
 *   the numbers it sold; `getActivePlan`, which Cloud composes with a Stripe
 *   subscription, reports the baseline so the subscription underneath applies.
 *
 * ## Design Note (SRP)
 *
 * This class has ONE reason to change: how licenses are stored and retrieved for organizations.
 * It intentionally delegates specialized concerns to focused modules:
 * - `validation.ts` - cryptographic validation and parsing
 * - `planMapping.ts` - license-to-plan transformation
 * - `errors.ts` - domain error types
 *
 * If this class grows to handle additional concerns (e.g., license renewal notifications,
 * usage tracking), consider extracting those into separate collaborators.
 */
export class LicenseHandler {
  private prisma: PrismaClient;
  private publicKey: string;
  private repository: ILicenseEnforcementRepository;
  private traceUsageService: ITraceUsageService | null;

  constructor(config: LicenseHandlerConfig) {
    this.prisma = config.prisma;
    this.publicKey = config.publicKey ?? PUBLIC_KEY;
    this.repository = config.repository;
    this.traceUsageService = config.traceUsageService ?? null;
  }

  /**
   * Gets the active plan for an organization based on its stored license, as
   * the *override* leg of the Cloud composite provider.
   *
   * Returns:
   * - UNLIMITED_PLAN if no license is stored
   * - License-based PlanInfo if a valid license exists
   * - UNLIMITED_PLAN if the license is unreadable, unsigned, or past its end
   *   date
   *
   * A license buys the Enterprise surface (SSO, SCIM, audit logs) and the
   * support relationship, not permission to run the software. Everything a
   * self-hosted deployment stores on its own infrastructure is uncapped without
   * one: seats, projects, teams, experimentation resources, and its own trace
   * history. That is what `UNLIMITED_PLAN` encodes.
   *
   * A license past its end date resolves here to that same baseline, and that
   * is what the composite provider needs: `UNLIMITED_PLAN.free` is true, so a
   * Cloud org whose license lapsed falls through to the Stripe subscription
   * sitting underneath it. Self-hosted has no such subscription to fall through
   * to, so it asks `getSelfHostedPlan` instead.
   */
  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    const licenseKey = await this.readStoredLicense(organizationId);

    if (!licenseKey) {
      return UNLIMITED_PLAN;
    }

    // Validate the stored license
    const result = validateLicense({ licenseKey, publicKey: this.publicKey });

    if (result.valid) {
      return result.planInfo;
    }

    return UNLIMITED_PLAN;
  }

  /**
   * Gets the active plan for a self-hosted deployment, where the stored license
   * is the only source of a plan and there is nothing underneath it to fall
   * through to.
   *
   * The signature decides, not the date. A license LangWatch signed is a record
   * of what was bought, and reaching its end date does not unmake the purchase,
   * so the numbers in the signed payload keep binding: seats stay at the count
   * that was paid for and the capabilities the plan names stay switched on.
   *
   * Resolving expiry the other way would make lapsing worth more than renewing.
   * The baseline is uncapped, so a deployment that let its license run out would
   * get its seat cap lifted and start reporting itself as unlicensed, which is
   * both a better deal than the customer paid for and a worse description of
   * reality.
   *
   * Nothing about access changes on that day. This resolves a plan, it does not
   * disable anybody, so an organization holding more members than a lapsed
   * license covers lands in the same over-seats state as one that just activated
   * a license for fewer seats than it had: everyone keeps working and only new
   * members are refused. See seat-reconciliation.feature.
   *
   * A license we did not sign is not a license. Its numbers could say anything,
   * so an unreadable or tampered key resolves to the baseline, exactly like no
   * license at all.
   */
  async getSelfHostedPlan(organizationId: string): Promise<PlanInfo> {
    const licenseKey = await this.readStoredLicense(organizationId);

    if (!licenseKey) {
      return UNLIMITED_PLAN;
    }

    const signedLicense = parseLicenseKey(licenseKey);

    if (!signedLicense || !verifySignature(signedLicense, this.publicKey)) {
      return UNLIMITED_PLAN;
    }

    return mapToPlanInfo(signedLicense.data);
  }

  private async readStoredLicense(
    organizationId: string,
  ): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { license: true },
    });

    return organization?.license ?? null;
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
    licenseKey: string,
  ): Promise<StoreLicenseResult> {
    // Validate the license before storing
    const result = validateLicense({ licenseKey, publicKey: this.publicKey });

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

    await this.provisionMissingRetentionPolicies(organizationId);

    return {
      success: true,
      planInfo,
    };
  }

  /**
   * A successfully activated license is a paid entry point, so it provisions
   * the same organization-scoped retention policies the Growth-Seat webhook
   * does — but create-if-absent only: a category that already has an
   * organization-level override is never overridden, so a manually-tuned
   * window survives license activation.
   *
   * Best-effort: a retention failure must never fail license activation, so
   * errors are logged and swallowed.
   */
  private async provisionMissingRetentionPolicies(
    organizationId: string,
  ): Promise<void> {
    try {
      const policy = getApp().dataRetention.policy;
      const existing = await policy.listOrganizationRules(organizationId);
      const covered = new Set(
        existing
          .filter(
            (row) =>
              row.scopeType === "ORGANIZATION" &&
              row.scopeId === organizationId,
          )
          .map((row) => row.category),
      );

      for (const category of RETENTION_CATEGORIES) {
        if (covered.has(category)) continue;
        try {
          await policy.setForScope({
            scope: { scopeType: "ORGANIZATION", scopeId: organizationId },
            category,
            retentionDays: PLATFORM_DEFAULT_RETENTION_DAYS,
          });
        } catch (err) {
          logger.error(
            { organizationId, category, err },
            "[license] Failed to provision retention policy on license activation",
          );
        }
      }
    } catch (err) {
      logger.error(
        { organizationId, err },
        "[license] Failed to provision retention policies on license activation",
      );
    }
  }

  /**
   * Gets the current license status for an organization.
   *
   * Returns details about whether a license exists, its validity,
   * plan type, and expiration date. Metadata is returned even for
   * invalid licenses so the UI can display "license expired" messages.
   */
  async getLicenseStatus(organizationId: string): Promise<LicenseStatus> {
    const licenseKey = await this.readStoredLicense(organizationId);

    if (!licenseKey) {
      return { hasLicense: false, valid: false };
    }

    const validationResult = validateLicense({
      licenseKey,
      publicKey: this.publicKey,
    });

    // For valid licenses, use data from validationResult (avoids second parse)
    if (validationResult.valid) {
      const { licenseData } = validationResult;
      const resourceCounts = await this.getResourceCounts(
        organizationId,
        licenseData.plan,
      );
      return {
        hasLicense: true,
        valid: true,
        plan: licenseData.plan.type,
        planName: licenseData.plan.name,
        expiresAt: licenseData.expiresAt,
        organizationName: licenseData.organizationName,
        ...resourceCounts,
      };
    }

    // For invalid licenses, parse separately to get metadata for UI display
    const signedLicense = parseLicenseKey(licenseKey);
    if (!signedLicense) {
      return { hasLicense: true, valid: false, corrupted: true };
    }

    const { data: licenseData } = signedLicense;
    const resourceCounts = await this.getResourceCounts(
      organizationId,
      licenseData.plan,
    );
    return {
      hasLicense: true,
      valid: false,
      // A lapsed license and one we never signed both read as invalid, and the
      // page has to tell them apart: the first still meters its seats, the
      // second means nothing at all. The date in the payload cannot answer that
      // on its own, since a forged payload can claim any date it likes, so the
      // answer comes from here, where the signature was actually checked.
      expired:
        verifySignature(signedLicense, this.publicKey) &&
        isExpired(licenseData.expiresAt),
      plan: licenseData.plan.type,
      planName: licenseData.plan.name,
      expiresAt: licenseData.expiresAt,
      organizationName: licenseData.organizationName,
      ...resourceCounts,
    };
  }

  /**
   * Fetches all resource counts for an organization and combines with plan limits.
   */
  private async getResourceCounts(
    organizationId: string,
    plan: LicensePlanLimits,
  ) {
    // Resolve defaults for optional plan fields
    const resolved = resolvePlanDefaults(plan);

    // Get message count via the app-layer UsageService (meter policy selects
    // traces vs events, counted in ClickHouse).
    // Returns 0 if service not provided (e.g., in tests).
    //
    // Both "unlimited" and "unknown" resolve to 0 because this figure feeds a
    // numeric license-usage display, but they are not the same claim and the
    // second one is worth being explicit about: it means the count could not
    // be taken, and rendering it as 0 understates usage until the counting
    // store recovers. It does not gate anything on its own — enforcement is
    // UsageService.checkLimit, which handles unknown deliberately — so this
    // stays a display value rather than becoming a reason to fail a license.
    const messagesCountPromise = this.traceUsageService
      ? this.traceUsageService
          .getCurrentMonthCount({ organizationId })
          .then((count) =>
            count === "unlimited" || count === USAGE_UNKNOWN ? 0 : count,
          )
      : Promise.resolve(0);

    const [currentMembers, currentMembersLite, currentMessagesPerMonth] =
      await Promise.all([
        this.repository.getMemberCount(organizationId),
        this.repository.getMembersLiteCount(organizationId),
        messagesCountPromise,
      ]);

    return {
      currentMembers,
      maxMembers: resolved.maxMembers,
      currentMembersLite,
      maxMembersLite: resolved.maxMembersLite,
      currentMessagesPerMonth,
      maxMessagesPerMonth: resolved.maxMessagesPerMonth,
    };
  }

  /**
   * Removes the license from an organization (idempotent).
   *
   * This clears all license-related fields, returning the organization to the
   * OSS baseline (`UNLIMITED_PLAN`) and withdrawing the Enterprise surface.
   *
   * @returns { removed: true } when complete
   * @throws OrganizationNotFoundError if organization does not exist
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
