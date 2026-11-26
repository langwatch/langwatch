import type { LicenseCryptography } from "@langwatch/enterprise-license-signing";
import {
  LICENSE_ERRORS,
  LicensingService as LicensingServiceContract,
  OrganizationNotFoundError,
  resolvePlanDefaults,
  type LicensePlanLimits,
  type LicenseStatus,
  type PlanInfo,
  type PlatformLicenseAccess,
  type RemoveLicenseResult,
  type StoreLicenseResult,
} from "@langwatch/enterprise-licensing-contract";
import { licenseResourceCounts } from "@langwatch/plans";
import { nowInstant, Temporal, toEpochMs, type Instant } from "@langwatch/time";

import type {
  OrganizationLicenseRepository,
  StoredLicense,
} from "../repositories/organization-license.repository.ts";
import { connectServicesNamedBy } from "../rules/connect-entitlement.rules.ts";
import { LicensePlanSourceService } from "./license-plan-source.service.ts";
import { PlatformSsoGateService } from "./platform-sso-gate.service.ts";

export type LicenseRetentionConfiguration = {
  categories: readonly string[];
  defaultDays: number;
};

export type LicenseServiceConfigurationInput = {
  retention?: LicenseRetentionConfiguration;
  now?: () => Instant;
  /** How long a sign-in waits on the platform SSO scan before denying (main's gate: 5 s). */
  ssoGateTimeoutMs?: number;
};

/** main's `GATE_EVALUATION_TIMEOUT_MS` (ee/sso/sso-gate.ts). */
const SSO_GATE_EVALUATION_TIMEOUT_MS = 5_000;

/** Immutable runtime configuration; environment resolution stays in composition. */
export class LicenseServiceConfiguration {
  private constructor(
    readonly retention: LicenseRetentionConfiguration | undefined,
    readonly now: () => Instant,
    readonly ssoGateTimeoutMs: number,
  ) {}

  static create(input: LicenseServiceConfigurationInput = {}): LicenseServiceConfiguration {
    return new LicenseServiceConfiguration(
      input.retention,
      input.now ?? nowInstant,
      input.ssoGateTimeoutMs ?? SSO_GATE_EVALUATION_TIMEOUT_MS,
    );
  }
}

class SilentLicenseLogger implements LicenseLogger {
  error(): void {}
}

export type LicenseServiceOptions = {
  repository: LicenseStorage;
  cryptography: LicenseCryptography;
  usage?: LicenseUsage;
  retention?: LicenseRetention;
  logger?: LicenseLogger;
  configuration?: LicenseServiceConfiguration;
  /** `LANGWATCH_LICENSE_KEY`, which licensing alone claims; absent where none is set. */
  instanceLicenseKey?: string | undefined;
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
  private readonly repository: LicenseStorage;
  private readonly cryptography: LicenseCryptography;
  private readonly usage: LicenseUsage | undefined;
  private readonly retention: LicenseRetention | undefined;
  private readonly logger: LicenseLogger;
  private readonly configuration: LicenseServiceConfiguration;
  /**
   * The plan half, composed rather than restated. `getActivePlan` and `getSelfHostedPlan` are
   * the two questions the entitlement source asks, and a process that resolves plans composes
   * the same service directly over the licence read alone.
   */
  private readonly plans: LicensePlanSourceService;
  private readonly ssoGate: PlatformSsoGateService;
  /** Bumped by every license this process stores or removes. */
  private storedRevision = 0;

  private constructor(options: LicenseServiceOptions) {
    super();
    this.repository = options.repository;
    this.cryptography = options.cryptography;
    this.plans = LicensePlanSourceService.create({
      licenses: options.repository,
      cryptography: options.cryptography,
      instanceLicenseKey: options.instanceLicenseKey,
    });
    this.usage = options.usage;
    this.retention = options.retention;
    this.logger = options.logger ?? new SilentLicenseLogger();
    this.configuration = options.configuration ?? LicenseServiceConfiguration.create();
    this.ssoGate = PlatformSsoGateService.create({
      licenses: options.repository,
      cryptography: options.cryptography,
      instanceLicenseKey: options.instanceLicenseKey,
      logger: this.logger,
      now: this.configuration.now,
      timeoutMs: this.configuration.ssoGateTimeoutMs,
    });
  }

  static create(options: LicenseServiceOptions): LicenseService {
    return new LicenseService(options);
  }

  inspectPlatformAccess(): Promise<PlatformLicenseAccess> {
    return this.ssoGate.inspectPlatformAccess();
  }

  /** `sha256:` digests of the licence key that permits the platform, empty where none does. */
  findPlatformLicenseDigests(): Promise<string[]> {
    return this.ssoGate.findPlatformLicenseDigests();
  }

  /** Whether a signed license on this deployment permits platform single sign-on (ADR-027 v9). */
  isPlatformSsoLicensed(input: { isSaas: boolean }): Promise<boolean> {
    return this.ssoGate.isPlatformSsoLicensed(input);
  }

  /** Changes on every license this process stores or removes. */
  licenseRevision(): number {
    return this.storedRevision;
  }

  /** Forgets a deny so the next request reads the store; an allow is kept. */
  invalidatePlatformSsoGate(): void {
    this.ssoGate.invalidate();
  }

  async getActivePlan(organizationId: string): Promise<PlanInfo> {
    return this.plans.getActivePlan(organizationId);
  }

  async getSelfHostedPlan(organizationId: string): Promise<PlanInfo> {
    return this.plans.getSelfHostedPlan(organizationId);
  }

  async validateAndStoreLicense({
    organizationId,
    licenseKey,
  }: {
    organizationId: string;
    licenseKey: string;
  }): Promise<StoreLicenseResult> {
    const stored = await this.validateAndWrite({
      organizationId,
      licenseKey,
      write: (license) => this.repository.storeLicense(organizationId, license).then(() => true),
    });
    if ("superseded" in stored) throw new Error("an unconditional store cannot be superseded");
    return stored;
  }

  /**
   * A license a sync delivered, stored only while the organization still holds
   * `replacing`, the key the sync started from: a slower sync never overwrites a
   * newer license another one applied meanwhile. `superseded` when it lost.
   */
  async storeDeliveredLicense({
    organizationId,
    licenseKey,
    replacing,
  }: {
    organizationId: string;
    licenseKey: string;
    replacing: string | null;
  }): Promise<StoreLicenseResult | { success: false; superseded: true }> {
    return this.validateAndWrite({
      organizationId,
      licenseKey,
      write: (license) => this.repository.replaceLicense({ organizationId, license, replacing }),
    });
  }

  private async validateAndWrite({
    organizationId,
    licenseKey,
    write,
  }: {
    organizationId: string;
    licenseKey: string;
    write: (license: StoredLicense) => Promise<boolean>;
  }): Promise<StoreLicenseResult | { success: false; superseded: true }> {
    const result = this.cryptography.validateLicense({ licenseKey });
    if (!result.valid) {
      return { success: false, error: result.error };
    }

    // A key that names an organization activates on that organization only.
    // A key minted before the claim existed carries none, and stays a bearer
    // token until it is reissued — see the migration note in
    // enterprise/modules/licensing/specs/licensing.feature.
    if (
      result.licenseData.organizationId !== void 0 &&
      result.licenseData.organizationId !== organizationId
    ) {
      return { success: false, error: LICENSE_ERRORS.ORGANIZATION_MISMATCH };
    }

    if (!(await this.repository.organizationExists(organizationId))) {
      throw new OrganizationNotFoundError();
    }

    const written = await write({
      licenseKey,
      expiresAt: Temporal.Instant.fromEpochMilliseconds(toEpochMs(result.licenseData.expiresAt)),
      validatedAt: this.configuration.now(),
    });
    if (!written) return { success: false, superseded: true };
    await this.provisionMissingRetentionPolicies(organizationId);
    // This process sees the license at once; other replicas within the deny TTL.
    this.storedRevision += 1;
    this.invalidatePlatformSsoGate();

    return { success: true, planInfo: result.planInfo };
  }

  async getLicenseStatus(organizationId: string): Promise<LicenseStatus> {
    const { licenseKey, source } = await this.plans.resolveLicenseKey(organizationId);
    if (!licenseKey) {
      return { hasLicense: false, valid: false };
    }

    const validation = this.cryptography.validateLicense({ licenseKey });
    if (validation.valid) {
      return {
        hasLicense: true,
        valid: true,
        plan: validation.licenseData.plan.type,
        planName: validation.licenseData.plan.name,
        expiresAt: validation.licenseData.expiresAt,
        organizationName: validation.licenseData.organizationName,
        source,
        connected: connectServicesNamedBy(validation.licenseData.connectServices).length > 0,
        ...(await this.getResourceCounts(organizationId, validation.licenseData.plan)),
      };
    }

    const signedLicense = this.cryptography.parseLicenseKey(licenseKey);
    if (!signedLicense) {
      return { hasLicense: true, valid: false, corrupted: true };
    }

    const { data } = signedLicense;
    const expired =
      this.cryptography.verifySignature(signedLicense) &&
      this.cryptography.isExpired(data.expiresAt);

    return {
      hasLicense: true,
      valid: false,
      expired,
      connected: expired && connectServicesNamedBy(data.connectServices).length > 0,
      plan: data.plan.type,
      planName: data.plan.name,
      expiresAt: data.expiresAt,
      organizationName: data.organizationName,
      source,
      ...(await this.getResourceCounts(organizationId, data.plan)),
    };
  }

  async removeLicense(organizationId: string): Promise<RemoveLicenseResult> {
    if (!(await this.repository.organizationExists(organizationId))) {
      throw new OrganizationNotFoundError();
    }

    await this.repository.removeLicense(organizationId);
    this.storedRevision += 1;

    return { removed: true };
  }

  /** Full member seats in use now, the same count the seat limit is enforced on. */
  countFullSeatsInUse(organizationId: string): Promise<number> {
    return this.repository.getMemberCount(organizationId);
  }

  countDevelopersInUse(organizationId: string): Promise<number> {
    return this.repository.getMembersDeveloperCount(organizationId);
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
    const [currentMembers, currentMembersLite, currentMessagesPerMonth] = await Promise.all([
      this.repository.getMemberCount(organizationId),
      this.repository.getMembersLiteCount(organizationId),
      messagesPromise,
    ]);

    return licenseResourceCounts({
      members: { current: currentMembers, max: resolved.maxMembers },
      membersLite: { current: currentMembersLite, max: resolved.maxMembersLite },
      messagesPerMonth: { current: currentMessagesPerMonth, max: resolved.maxMessagesPerMonth },
    });
  }

  private async provisionMissingRetentionPolicies(organizationId: string): Promise<void> {
    const retentionConfiguration = this.configuration.retention;
    if (!this.retention || !retentionConfiguration) {
      return;
    }

    try {
      const existing = await this.retention.listOrganizationRules(organizationId);
      const covered = new Set(
        existing
          .filter((rule) => rule.scopeType === "ORGANIZATION" && rule.scopeId === organizationId)
          .map((rule) => rule.category),
      );
      for (const category of retentionConfiguration.categories) {
        if (covered.has(category)) {
          continue;
        }

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

export interface LicenseLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export type LicenseRetentionRule = {
  scopeType: string;
  scopeId: string;
  category: string;
};

export interface LicenseRetention {
  listOrganizationRules(organizationId: string): Promise<readonly LicenseRetentionRule[]>;

  setForOrganization(input: {
    organizationId: string;
    category: string;
    retentionDays: number;
  }): Promise<void>;
}

export type LicenseUsageCount = number | "unlimited" | "unknown";

export interface LicenseUsage {
  getCurrentMonthCount(input: { organizationId: string }): Promise<LicenseUsageCount>;
}

/**
 * Persistence and seat-count port. Concrete database adapters stay in
 * apps, except the reads, inherited from `OrganizationLicenseReads` so a
 * plan-resolution-only process can compose those alone, without seats.
 */
export interface LicenseStorage extends Pick<
  OrganizationLicenseRepository,
  "getOrganizationLicense" | "findOrganizationsWithLicense" | "organizationExists"
> {
  storeLicense(organizationId: string, license: StoredLicense): Promise<void>;
  /** Stores only while the organization still holds `replacing`; whether it stored. */
  replaceLicense(
    input: Readonly<{ organizationId: string; license: StoredLicense; replacing: string | null }>,
  ): Promise<boolean>;
  removeLicense(organizationId: string): Promise<void>;
  getMemberCount(organizationId: string): Promise<number>;
  getMembersLiteCount(organizationId: string): Promise<number>;
  getMembersDeveloperCount(organizationId: string): Promise<number>;
}
