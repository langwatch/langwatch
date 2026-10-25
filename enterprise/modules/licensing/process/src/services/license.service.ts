import { createHash } from "node:crypto";

import { isUpgradeInProgress } from "@langwatch/api";
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
  type PlatformLicenseInspection,
  type RemoveLicenseResult,
  type StoreLicenseResult,
} from "@langwatch/enterprise-licensing-contract";
import { HandledError } from "@langwatch/handled-error";
import { licenseResourceCounts } from "@langwatch/plans";
import { nowInstant, Temporal, toEpochMs, type Instant } from "@langwatch/time";

import type {
  OrganizationLicenseRepository,
  StoredLicense,
} from "../repositories/organization-license.repository.ts";
import { connectServicesNamedBy } from "../rules/connect-entitlement.rules.ts";
import { isTestingLicense } from "../rules/testing-license.rules.ts";
import { LicensePlanSourceService } from "./license-plan-source.service.ts";
import { PlatformSsoGateService } from "./platform-sso-gate.service.ts";
import {
  TestingLicenseGateService,
  type PlatformLicenseVerdict,
} from "./testing-license-gate.service.ts";

/** An organization that no longer exists holds no licence: the status read answers unlicensed. */
const unlicensedWhenMissing = (error: unknown): { licenseKey: null } => {
  if (HandledError.isHandled(error) && error.code === "organization_not_found")
    return { licenseKey: null };
  throw error;
};

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
  /** `LicensingApi.getInstanceId`; where none is wired, every testing licence is refused. */
  instanceId?: () => Promise<string>;
  /** `LANGWATCH_CONNECT_INSTANCE_ID` is set: every testing licence is refused (ADR-180). */
  instanceIdOverridden?: boolean;
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
  private readonly testing: TestingLicenseGateService;
  private readonly platformSso: PlatformSsoGateService;
  /** Bumped by every license this process stores or removes. */
  private storedRevision = 0;
  private readonly instanceLicenseKey: string | undefined;

  private constructor(options: LicenseServiceOptions) {
    super();
    this.repository = options.repository;
    this.cryptography = options.cryptography;
    this.instanceLicenseKey = options.instanceLicenseKey;
    this.usage = options.usage;
    this.retention = options.retention;
    this.logger = options.logger ?? new SilentLicenseLogger();
    this.configuration = options.configuration ?? LicenseServiceConfiguration.create();
    this.plans = LicensePlanSourceService.create({
      licenses: options.repository,
      cryptography: options.cryptography,
      ...(options.instanceId ? { instanceId: options.instanceId } : {}),
      instanceIdOverridden: options.instanceIdOverridden ?? false,
      now: this.configuration.now,
    });
    this.testing = TestingLicenseGateService.create({
      instanceId: options.instanceId,
      instanceIdOverridden: options.instanceIdOverridden ?? false,
      now: this.configuration.now,
    });
    this.platformSso = PlatformSsoGateService.create({
      scan: () => this.inspectPlatformAccess(),
      onScanFailure: (error) => logScanFailure({ logger: this.logger, error }),
      now: this.configuration.now,
      timeoutMs: this.configuration.ssoGateTimeoutMs,
    });
  }

  static create(options: LicenseServiceOptions): LicenseService {
    return new LicenseService(options);
  }

  async inspectPlatformAccess(): Promise<PlatformLicenseAccess> {
    return (await this.scanPlatformLicenses()).access;
  }

  /** `sha256:` of the licence key that permits the platform, empty where none does: the
   *  evidence a licence-proved domain records, so the key itself never leaves licensing. */
  async findPlatformLicenseDigests(): Promise<string[]> {
    const { permitting } = await this.scanPlatformLicenses();
    if (permitting === undefined) return [];
    return [`sha256:${createHash("sha256").update(permitting).digest("hex")}`];
  }

  /** The instance key first, then every stored one, until one permits the platform. */
  private async scanPlatformLicenses(): Promise<{
    access: PlatformLicenseAccess;
    permitting?: string;
  }> {
    const inspections: PlatformLicenseInspection[] = [];
    const now = this.configuration.now();
    // Read once a scan, and only once a testing licence is met.
    let instanceId: Promise<string | undefined> | undefined;
    const findInstanceId = () => (instanceId ??= this.testing.findInstanceId());
    const permits = async (
      licenseKey: string,
      source: Pick<PlatformLicenseInspection, "source" | "organizationId">,
    ): Promise<{ access: PlatformLicenseAccess; permitting: string } | undefined> => {
      const verdict = await this.inspectPlatformLicense({
        licenseKey,
        source,
        now,
        instanceId: findInstanceId,
      });
      inspections.push(verdict.inspection);
      if (!verdict.inspection.valid) return undefined;
      const allowedUntil = verdict.allowedUntil ? { allowedUntil: verdict.allowedUntil } : {};
      return { access: { allowed: true, inspections, ...allowedUntil }, permitting: licenseKey };
    };
    if (this.instanceLicenseKey) {
      const permitted = await permits(this.instanceLicenseKey, { source: "instance" });
      if (permitted) return permitted;
    }

    const candidates = await this.repository.findOrganizationsWithLicense();
    for (const candidate of candidates) {
      const source = { source: "organization" as const, organizationId: candidate.organizationId };
      const permitted = await permits(candidate.licenseKey, source);
      if (permitted) return permitted;
    }

    return { access: { allowed: false, inspections } };
  }

  /** Whether a signed license permits platform single sign-on (see `PlatformSsoGateService`). */
  async isPlatformSsoLicensed({ isSaas }: { isSaas: boolean }): Promise<boolean> {
    if (isSaas) return true;
    return this.platformSso.isLicensed();
  }

  /** Changes on every license this process stores or removes. */
  licenseRevision(): number {
    return this.storedRevision;
  }

  /** Forgets a deny so the next request reads the store; an allow is kept. */
  invalidatePlatformSsoGate(): void {
    this.platformSso.invalidate();
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
    const result = this.cryptography.validateLicense({ licenseKey });
    if (!result.valid) {
      return { success: false, error: result.error };
    }

    // A testing licence activates only unexpired, on its instance, for its organization.
    const testing = await this.testing.judge({
      license: result.licenseData,
      organizationId,
    });
    if (!testing.honoured) return { success: false, error: testing.error };

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

    await this.repository.storeLicense(organizationId, {
      licenseKey,
      expiresAt: Temporal.Instant.fromEpochMilliseconds(toEpochMs(result.licenseData.expiresAt)),
      validatedAt: this.configuration.now(),
    });
    await this.provisionMissingRetentionPolicies(organizationId);
    // This process sees the license at once; other replicas within the deny TTL.
    this.storedRevision += 1;
    this.invalidatePlatformSsoGate();

    return { success: true, planInfo: result.planInfo };
  }

  async getLicenseStatus(organizationId: string): Promise<LicenseStatus> {
    const { licenseKey } = await this.repository
      .getOrganizationLicense(organizationId)
      .catch(unlicensedWhenMissing);
    if (!licenseKey) {
      return { hasLicense: false, valid: false };
    }

    const validation = this.cryptography.validateLicense({ licenseKey });
    const honoured =
      validation.valid &&
      (await this.testing.judge({ license: validation.licenseData, organizationId })).honoured;
    if (validation.valid && honoured) {
      return {
        hasLicense: true,
        valid: true,
        plan: validation.licenseData.plan.type,
        planName: validation.licenseData.plan.name,
        expiresAt: validation.licenseData.expiresAt,
        organizationName: validation.licenseData.organizationName,
        connected: connectServicesNamedBy(validation.licenseData.connectServices).length > 0,
        ...(await this.getResourceCounts(organizationId, validation.licenseData.plan)),
      };
    }

    const signedLicense = this.cryptography.parseLicenseKey(licenseKey);
    if (!signedLicense) {
      return { hasLicense: true, valid: false, corrupted: true };
    }

    const { data } = signedLicense;
    // A testing licence's term is read on the injected clock, as its refusal was.
    const expiredAt = isTestingLicense(data) ? this.configuration.now() : undefined;

    return {
      hasLicense: true,
      valid: false,
      expired:
        this.cryptography.verifySignature(signedLicense) &&
        this.cryptography.isExpired(data.expiresAt, expiredAt),
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
    this.storedRevision += 1;

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

  private async inspectPlatformLicense({
    licenseKey,
    source,
    now,
    instanceId,
  }: {
    licenseKey: string;
    source: Pick<PlatformLicenseInspection, "source" | "organizationId">;
    now: Instant;
    instanceId: () => Promise<string | undefined>;
  }): Promise<PlatformLicenseVerdict> {
    const signedLicense = this.cryptography.parseLicenseKey(licenseKey);
    if (!signedLicense) {
      return { inspection: { ...source, valid: false, reason: "invalid_format" } };
    }

    if (!this.cryptography.verifySignature(signedLicense)) {
      return { inspection: { ...source, valid: false, reason: "invalid_signature" } };
    }

    // A stored key that names another organization is not this organization's
    // entitlement, however genuine the signature is.
    const claimed = signedLicense.data.organizationId;
    if (
      claimed !== void 0 &&
      source.organizationId !== void 0 &&
      claimed !== source.organizationId
    ) {
      return { inspection: { ...source, valid: false, reason: "organization_mismatch" } };
    }

    const genuine = {
      ...source,
      expiresAt: signedLicense.data.expiresAt,
      organizationName: signedLicense.data.organizationName,
    };
    if (!isTestingLicense(signedLicense.data)) {
      const expired = this.cryptography.isExpired(genuine.expiresAt);
      return { inspection: { ...genuine, valid: true, expired } };
    }

    return this.testing.inspectPlatform({
      license: signedLicense.data,
      source,
      genuine,
      now,
      instanceId,
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

/** Before the worker creates the license table (install, upgrade) a failed scan is expected. */
function logScanFailure({ logger, error }: { logger: LicenseLogger; error: unknown }): void {
  if (isUpgradeInProgress(error)) return;
  logger.error({ error }, "the platform single sign-on license scan failed; denying for now");
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
  removeLicense(organizationId: string): Promise<void>;
  getMemberCount(organizationId: string): Promise<number>;
  getMembersLiteCount(organizationId: string): Promise<number>;
}
