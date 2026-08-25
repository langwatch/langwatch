import {
  LicensingService as LicensingServiceContract,
  OrganizationNotFoundError,
  UNLIMITED_PLAN,
  mapToPlanInfo,
  resolvePlanDefaults,
  type LicensePlanLimits,
  type LicenseStatus,
  type PlanInfo,
  type PlatformLicenseAccess,
  type PlatformLicenseInspection,
  type RemoveLicenseResult,
  type StoreLicenseResult,
} from "@langwatch/enterprise-licensing-contract";
import type { LicenseCryptographyPort } from "../ports/license-cryptography.port";
import type { LicenseLoggerPort } from "../ports/license-logger.port";
import type { LicenseRetentionPort } from "../ports/license-retention.port";
import type { LicenseUsagePort } from "../ports/license-usage.port";
import type { LicenseRepository } from "../repositories/license.repository";

export type LicenseRetentionConfiguration = {
  categories: readonly string[];
  defaultDays: number;
};

export type LicenseServiceConfigurationInput = {
  retention?: LicenseRetentionConfiguration;
  now?: () => Date;
};

/** Immutable runtime configuration; environment resolution stays in composition. */
export class LicenseServiceConfiguration {
  private constructor(
    readonly retention: LicenseRetentionConfiguration | undefined,
    readonly now: () => Date,
  ) {}

  static create(
    input: LicenseServiceConfigurationInput = {},
  ): LicenseServiceConfiguration {
    return new LicenseServiceConfiguration(
      input.retention,
      input.now ?? (() => new Date()),
    );
  }
}

class SilentLicenseLogger implements LicenseLoggerPort {
  error(): void {}
}

export type LicenseServiceOptions = {
  repository: LicenseRepository;
  cryptography: LicenseCryptographyPort;
  usage?: LicenseUsagePort;
  retention?: LicenseRetentionPort;
  logger?: LicenseLoggerPort;
  configuration?: LicenseServiceConfiguration;
};

type LicenseResourceCounts = {
  currentMembers: number;
  maxMembers: number;
  currentMembersLite: number;
  maxMembersLite: number;
  currentMessagesPerMonth: number;
  maxMessagesPerMonth: number;
};

/** Signed-license plan source and lifecycle service. */
export class LicenseService extends LicensingServiceContract {
  private readonly repository: LicenseRepository;
  private readonly cryptography: LicenseCryptographyPort;
  private readonly usage: LicenseUsagePort | undefined;
  private readonly retention: LicenseRetentionPort | undefined;
  private readonly logger: LicenseLoggerPort;
  private readonly configuration: LicenseServiceConfiguration;

  private constructor(options: LicenseServiceOptions) {
    super();
    this.repository = options.repository;
    this.cryptography = options.cryptography;
    this.usage = options.usage;
    this.retention = options.retention;
    this.logger = options.logger ?? new SilentLicenseLogger();
    this.configuration =
      options.configuration ?? LicenseServiceConfiguration.create();
  }

  static create(options: LicenseServiceOptions): LicenseService {
    return new LicenseService(options);
  }

  async inspectPlatformAccess(input: {
    instanceLicenseKey?: string | undefined;
  }): Promise<PlatformLicenseAccess> {
    const inspections: PlatformLicenseInspection[] = [];
    if (input.instanceLicenseKey) {
      const inspection = this.inspectPlatformLicense(
        input.instanceLicenseKey,
        { source: "instance" },
      );
      inspections.push(inspection);
      if (inspection.valid) return { allowed: true, inspections };
    }

    const candidates = await this.repository.findOrganizationsWithLicense();
    for (const candidate of candidates) {
      const inspection = this.inspectPlatformLicense(candidate.licenseKey, {
        source: "organization",
        organizationId: candidate.organizationId,
      });
      inspections.push(inspection);
      if (inspection.valid) return { allowed: true, inspections };
    }
    return { allowed: false, inspections };
  }

  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    const licenseKey = await this.repository.tryReadLicense(organizationId);
    if (!licenseKey) return UNLIMITED_PLAN;

    const result = this.cryptography.validateLicense({ licenseKey });
    return result.valid ? result.planInfo : UNLIMITED_PLAN;
  }

  async getSelfHostedPlan(organizationId: string): Promise<PlanInfo> {
    const licenseKey = await this.repository.tryReadLicense(organizationId);
    if (!licenseKey) return UNLIMITED_PLAN;

    const signedLicense = this.cryptography.tryParseLicenseKey(licenseKey);
    if (!signedLicense || !this.cryptography.verifySignature(signedLicense)) {
      return UNLIMITED_PLAN;
    }
    return mapToPlanInfo(signedLicense.data);
  }

  async validateAndStoreLicense(
    organizationId: string,
    licenseKey: string,
  ): Promise<StoreLicenseResult> {
    const result = this.cryptography.validateLicense({ licenseKey });
    if (!result.valid) return { success: false, error: result.error };
    if (!(await this.repository.organizationExists(organizationId))) {
      throw new OrganizationNotFoundError();
    }

    await this.repository.storeLicense(organizationId, {
      licenseKey,
      expiresAt: new Date(result.licenseData.expiresAt),
      validatedAt: this.configuration.now(),
    });
    await this.provisionMissingRetentionPolicies(organizationId);
    return { success: true, planInfo: result.planInfo };
  }

  async getLicenseStatus(organizationId: string): Promise<LicenseStatus> {
    const licenseKey = await this.repository.tryReadLicense(organizationId);
    if (!licenseKey) return { hasLicense: false, valid: false };

    const validation = this.cryptography.validateLicense({ licenseKey });
    if (validation.valid) {
      return {
        hasLicense: true,
        valid: true,
        plan: validation.licenseData.plan.type,
        planName: validation.licenseData.plan.name,
        expiresAt: validation.licenseData.expiresAt,
        organizationName: validation.licenseData.organizationName,
        ...(await this.getResourceCounts(
          organizationId,
          validation.licenseData.plan,
        )),
      };
    }

    const signedLicense = this.cryptography.tryParseLicenseKey(licenseKey);
    if (!signedLicense) {
      return { hasLicense: true, valid: false, corrupted: true };
    }
    const { data } = signedLicense;
    return {
      hasLicense: true,
      valid: false,
      expired:
        this.cryptography.verifySignature(signedLicense) &&
        this.cryptography.isExpired(data.expiresAt),
      plan: data.plan.type,
      planName: data.plan.name,
      expiresAt: data.expiresAt,
      organizationName: data.organizationName,
      ...(await this.getResourceCounts(organizationId, data.plan)),
    };
  }

  async removeLicense(organizationId: string): Promise<RemoveLicenseResult> {
    if (!(await this.repository.organizationExists(organizationId))) {
      throw new OrganizationNotFoundError();
    }
    await this.repository.removeLicense(organizationId);
    return { removed: true };
  }

  private async getResourceCounts(
    organizationId: string,
    plan: LicensePlanLimits,
  ): Promise<LicenseResourceCounts> {
    const resolved = resolvePlanDefaults(plan);
    const messagesPromise = this.usage
      ? this.usage
          .getCurrentMonthCount({ organizationId })
          .then((count) => (typeof count === "number" ? count : 0))
      : Promise.resolve(0);
    const [currentMembers, currentMembersLite, currentMessagesPerMonth] =
      await Promise.all([
        this.repository.getMemberCount(organizationId),
        this.repository.getMembersLiteCount(organizationId),
        messagesPromise,
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

  private inspectPlatformLicense(
    licenseKey: string,
    source: Pick<PlatformLicenseInspection, "source" | "organizationId">,
  ): PlatformLicenseInspection {
    const signedLicense = this.cryptography.tryParseLicenseKey(licenseKey);
    if (!signedLicense) {
      return { ...source, valid: false, reason: "invalid_format" };
    }
    if (!this.cryptography.verifySignature(signedLicense)) {
      return { ...source, valid: false, reason: "invalid_signature" };
    }
    return {
      ...source,
      valid: true,
      expiresAt: signedLicense.data.expiresAt,
      organizationName: signedLicense.data.organizationName,
      expired: this.cryptography.isExpired(signedLicense.data.expiresAt),
    };
  }

  private async provisionMissingRetentionPolicies(
    organizationId: string,
  ): Promise<void> {
    const retentionConfiguration = this.configuration.retention;
    if (!this.retention || !retentionConfiguration) return;

    try {
      const existing =
        await this.retention.listOrganizationRules(organizationId);
      const covered = new Set(
        existing
          .filter(
            (rule) =>
              rule.scopeType === "ORGANIZATION" &&
              rule.scopeId === organizationId,
          )
          .map((rule) => rule.category),
      );
      for (const category of retentionConfiguration.categories) {
        if (covered.has(category)) continue;
        try {
          await this.retention.setForOrganization({
            organizationId,
            category,
            retentionDays: retentionConfiguration.defaultDays,
          });
        } catch (error) {
          this.logger.error(
            { organizationId, category, error },
            "[license] Failed to provision retention policy on license activation",
          );
        }
      }
    } catch (error) {
      this.logger.error(
        { organizationId, error },
        "[license] Failed to provision retention policies on license activation",
      );
    }
  }
}
