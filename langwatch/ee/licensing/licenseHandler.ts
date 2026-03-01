import type { PrismaClient } from "@prisma/client";
import type { PlanInfo } from "./planInfo";
import { FREE_PLAN, PUBLIC_KEY } from "./constants";
import { resolvePlanDefaults } from "./defaults";
import { OrganizationNotFoundError } from "./errors";
import type { LicenseStatus, RemoveLicenseResult, StoreLicenseResult, LicensePlanLimits } from "./types";
import { validateLicense, parseLicenseKey } from "./validation";
import type { ILicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";

/**
 * Interface for trace usage counting.
 * Follows Interface Segregation Principle - only what we need.
 */
export interface ITraceUsageService {
  getCurrentMonthCount(params: { organizationId: string }): Promise<number>;
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
 * - No license stored = FREE_PLAN (restricted access)
 * - Valid license = license-based limits
 * - Invalid/expired license = FREE_PLAN (restricted fallback)
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
      select: { license: true },
    });

    if (!organization?.license) {
      return { hasLicense: false, valid: false };
    }

    const validationResult = validateLicense(organization.license, this.publicKey);

    // For valid licenses, use data from validationResult (avoids second parse)
    if (validationResult.valid) {
      const { licenseData } = validationResult;
      const resourceCounts = await this.getResourceCounts(organizationId, licenseData.plan);
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
    const signedLicense = parseLicenseKey(organization.license);
    if (!signedLicense) {
      return { hasLicense: true, valid: false, corrupted: true };
    }

    const { data: licenseData } = signedLicense;
    const resourceCounts = await this.getResourceCounts(organizationId, licenseData.plan);
    return {
      hasLicense: true,
      valid: false,
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
  private async getResourceCounts(organizationId: string, plan: LicensePlanLimits) {
    // Resolve defaults for optional plan fields
    const resolved = resolvePlanDefaults(plan);

    // Get message count via orchestrated UsageService (applies meter policy)
    // Returns 0 if service not provided (e.g., in tests)
    const messagesCountPromise = this.traceUsageService
      ? this.traceUsageService.getCurrentMonthCount({ organizationId })
      : Promise.resolve(0);

    const [
      currentMembers,
      currentMembersLite,
      currentTeams,
      currentProjects,
      currentPrompts,
      currentWorkflows,
      currentScenarios,
      currentEvaluators,
      currentAgents,
      currentExperiments,
      currentOnlineEvaluations,
      currentDatasets,
      currentDashboards,
      currentCustomGraphs,
      currentAutomations,
      currentMessagesPerMonth,
      currentEvaluationsCredit,
    ] = await Promise.all([
      this.repository.getMemberCount(organizationId),
      this.repository.getMembersLiteCount(organizationId),
      this.repository.getTeamCount(organizationId),
      this.repository.getProjectCount(organizationId),
      this.repository.getPromptCount(organizationId),
      this.repository.getWorkflowCount(organizationId),
      this.repository.getActiveScenarioCount(organizationId),
      this.repository.getEvaluatorCount(organizationId),
      this.repository.getAgentCount(organizationId),
      this.repository.getExperimentCount(organizationId),
      this.repository.getOnlineEvaluationCount(organizationId),
      this.repository.getDatasetCount(organizationId),
      this.repository.getDashboardCount(organizationId),
      this.repository.getCustomGraphCount(organizationId),
      this.repository.getAutomationCount(organizationId),
      messagesCountPromise,
      this.repository.getEvaluationsCreditUsed(organizationId),
    ]);

    return {
      currentMembers,
      maxMembers: resolved.maxMembers,
      currentMembersLite,
      maxMembersLite: resolved.maxMembersLite,
      currentTeams,
      maxTeams: resolved.maxTeams,
      currentProjects,
      maxProjects: resolved.maxProjects,
      currentPrompts,
      maxPrompts: resolved.maxPrompts,
      currentWorkflows,
      maxWorkflows: resolved.maxWorkflows,
      currentScenarios,
      maxScenarios: resolved.maxScenarios,
      currentEvaluators,
      maxEvaluators: resolved.maxEvaluators,
      currentAgents,
      maxAgents: resolved.maxAgents,
      currentExperiments,
      maxExperiments: resolved.maxExperiments,
      currentOnlineEvaluations,
      maxOnlineEvaluations: resolved.maxOnlineEvaluations,
      currentDatasets,
      maxDatasets: resolved.maxDatasets,
      currentDashboards,
      maxDashboards: resolved.maxDashboards,
      currentCustomGraphs,
      maxCustomGraphs: resolved.maxCustomGraphs,
      currentAutomations,
      maxAutomations: resolved.maxAutomations,
      currentMessagesPerMonth,
      maxMessagesPerMonth: resolved.maxMessagesPerMonth,
      currentEvaluationsCredit,
      maxEvaluationsCredit: resolved.evaluationsCredit,
    };
  }

  /**
   * Removes the license from an organization (idempotent).
   *
   * This clears all license-related fields, returning the organization
   * to unlimited mode (when enforcement is disabled) or FREE_PLAN
   * (when enforcement is enabled).
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
