/**
 * The licensing feature's application: what both of its doors call. It holds every service and
 * port the feature's api files reach, and it is the one typed thing a transport is given.
 */
import {
  LicensingApi,
  type LicensingApi as LicensingApiContract,
  buildMintedPlan,
  LicenseExpiryNotInFutureError,
  licenseValidationError,
  limitTypes,
  type LicenseData,
  type LicenseLimitCheck,
  type LicensingCaller,
  type LimitCheckResult,
  type LimitType,
  type LicensingServerConfig,
  type MintLicenseKeyInput,
  type SsoGateStatus,
  licensingConfig,
} from "@langwatch/enterprise-licensing-contract";
import type { ResolvePlanInput } from "@langwatch/entitlement-contract";
import { PrismaUsageMembershipRepository } from "@langwatch/entitlement-process";
import type { FeatureSetup } from "@langwatch/kernel";
import { getPlanTemplate, quotedPlanLimitsOf } from "@langwatch/plans";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { fromDate, nowInstant, Temporal } from "@langwatch/time";

import { LicenseService, LicenseServiceConfiguration } from "../services/license.service.ts";
import { LicensingEntitlementSourceAdapter } from "../services/licensing-entitlement-source.service.ts";
import { createUnavailableLicensingInfrastructure } from "../services/licensing-infrastructure.service.ts";
import { NodeLicenseCryptographyAdapter } from "../services/node-license-cryptography.service.ts";
import type {
  LicenseCryptography,
  LicenseLogger,
  LicenseRetention,
  LicenseStorage,
  LicenseUsage,
} from "./licensing.members.ts";

/** Seat counts entitlement already keeps: a peer's own read, not a licence mutation. */
function seatCountsOverPrisma(
  database: Parameters<typeof PrismaUsageMembershipRepository.create>[0],
): Pick<LicensingInfrastructure["repository"], "getMemberCount" | "getMembersLiteCount"> {
  const memberships = PrismaUsageMembershipRepository.create(database);
  return {
    getMemberCount: (organizationId) => memberships.getMemberCount(organizationId),
    getMembersLiteCount: (organizationId) => memberships.getMembersLiteCount(organizationId),
  };
}

/** What the process composes this feature's application from. */
export type LicensingInfrastructure = Readonly<{
  repository: LicenseStorage;
  usage?: LicenseUsage;
  retention?: LicenseRetention;
  logger?: LicenseLogger;
  /**
   * The provider name the deployment is CONFIGURED with, before the license
   * gate and the mount inspector have their say. `null` or `"email"` means
   * nobody asked for federation.
   */
  configuredAuthProvider: () => string | null | undefined;
  /** Whether the license permits platform single sign-on. */
  platformSsoAllowed: () => Promise<boolean>;
  /** Whether the configured provider actually mounted. */
  authProviderIsMounted: () => boolean;
  /** Records a signing failure; the customer never sees the diagnostic. */
  reportSigningFailure: (entry: Readonly<{ organizationId: string; error: Error }>) => void;
  /** Whether one limit still admits another resource, for this caller. */
  checkLimit: (input: LicenseLimitCheck) => Promise<LimitCheckResult>;
  /**
   * Tells operations a customer reached a ceiling. A second feature's
   * capability, composed in rather than reached through a request: an alert is
   * raised by the same deployment that answered the check.
   */
  notifyLimitReached: (
    input: Readonly<{
      organizationId: string;
      limitType: LimitType;
      current: number;
      max: number;
    }>,
  ) => Promise<void>;
  /** Swallows a notification failure into the process's error channel. */
  reportError: (error: Error) => void;
}>;

export type LicensingRuntime = Readonly<
  Omit<LicensingInfrastructure, "repository" | "usage" | "retention" | "logger">
>;

/**
 * Production supplies the closed members and the app derives its own
 * infrastructure; `infrastructure` is the test-only fabric seam.
 */
type LicensingProcessMembers = Readonly<{ isSaas: boolean }> &
  (
    | (MembersRead<readonly ["prisma", "logger"]> & { infrastructure?: never })
    | Readonly<{ prisma?: never; logger?: LicenseLogger; infrastructure: LicensingInfrastructure }>
  );

type LicensingSetup = FeatureSetup<
  Record<never, never>,
  LicensingProcessMembers,
  LicensingServerConfig
>;

export class LicensingApp implements LicensingApiContract {
  static readonly contract: typeof LicensingApi = LicensingApi;
  static readonly dependencies: Readonly<Record<string, never>> = {};
  static readonly config = licensingConfig;
  /** `isSaas` is the process's own fact, drilled in; IS_SAAS has one owner. */
  static readonly reads = [...reads("prisma", "logger"), "isSaas"] as const;

  readonly #service: LicenseService;
  readonly #entitlements: LicensingEntitlementSourceAdapter;
  readonly #cryptography: LicenseCryptography;
  readonly #runtime: LicensingRuntime;

  private constructor(
    service: LicenseService,
    cryptography: LicenseCryptography,
    runtime: LicensingRuntime,
    entitlements: LicensingEntitlementSourceAdapter,
  ) {
    this.#service = service;
    this.#entitlements = entitlements;
    this.#cryptography = cryptography;
    this.#runtime = runtime;
  }

  static create({ members, config }: LicensingSetup): LicensingApp {
    const cryptography = NodeLicenseCryptographyAdapter.create({ publicKey: config.publicKey });
    // Derived from the closed prisma member: the licence read is live, the seat
    // counts are entitlement's own membership classification (peer, not owned
    // here), and the mutation/enforcement ports refuse by name until a process
    // composes them.
    const infrastructure =
      members.infrastructure !== undefined
        ? members.infrastructure
        : createUnavailableLicensingInfrastructure({
            database: members.prisma,
            processName: "this process",
            ...seatCountsOverPrisma(members.prisma),
          });
    const { repository, usage, retention, logger, ...runtime } = infrastructure;
    const service = LicenseService.create({
      repository,
      cryptography,
      usage,
      retention,
      logger: logger ?? members.logger,
      configuration: LicenseServiceConfiguration.create(),
    });
    return new LicensingApp(
      service,
      cryptography,
      runtime,
      LicensingEntitlementSourceAdapter.create({
        licensing: service,
        mode: members.isSaas ? "cloud" : "self-hosted",
      }),
    );
  }

  resolve(input: ResolvePlanInput) {
    return this.#entitlements.resolve(input);
  }

  /** The license an organization is running on, its plan and its usage. */
  getLicenseStatus(organizationId: string) {
    return this.#service.getLicenseStatus(organizationId);
  }

  /**
   * Why a deployment configured for single sign-on is not using it.
   */
  async getSsoGateStatus(): Promise<SsoGateStatus> {
    const configuredProvider = this.#runtime.configuredAuthProvider();
    if (!configuredProvider || configuredProvider === "email") {
      return { configuredProvider: null, licensed: true, mounted: true };
    }

    return {
      configuredProvider,
      licensed: await this.#runtime.platformSsoAllowed(),
      mounted: this.#runtime.authProviderIsMounted(),
    };
  }

  /**
   * Validates a pasted key and stores it, answering the plan it grants.
   */
  async uploadLicense(input: Readonly<{ organizationId: string; licenseKey: string }>) {
    const result = await this.#service.validateAndStoreLicense({
      organizationId: input.organizationId,
      licenseKey: input.licenseKey,
    });

    if (!result.success) throw licenseValidationError(result.error);

    return result.planInfo;
  }

  /** Drops the key, returning the organization to the free tier. */
  removeLicense(organizationId: string) {
    return this.#service.removeLicense(organizationId);
  }

  /**
   * Mints and signs a key from a private key the operator pasted in. Everything a key contains
   * is decided here: which template the plan type resolves to, what the minted plan carries,
   * and when the key was issued.
   */
  mintLicenseKey(input: MintLicenseKeyInput): string {
    const expiresAt = fromDate(input.expiresAt);
    const termAlreadyElapsed = Temporal.Instant.compare(expiresAt, nowInstant()) <= 0;
    if (termAlreadyElapsed) throw new LicenseExpiryNotInFutureError();

    const template = getPlanTemplate(input.planType);
    const cryptography = this.#cryptography;

    const licenseData: LicenseData = {
      licenseId: cryptography.generateLicenseId(),
      version: 1,
      organizationName: input.organizationName,
      email: input.email,
      issuedAt: nowInstant().toString({ fractionalSecondDigits: 3 }),
      expiresAt: expiresAt.toString({ fractionalSecondDigits: 3 }),
      plan: buildMintedPlan({
        type: template?.type ?? input.planType,
        name: template?.name ?? input.planType,
        ...quotedPlanLimitsOf(input.plan),
        webhookEndpointsEnabled: input.plan.webhookEndpointsEnabled,
        usageUnit: input.plan.usageUnit,
      }),
      // The binding: without it the key activates on any organization.
      organizationId: input.organizationId,
    };

    try {
      return cryptography.encodeLicenseKey(cryptography.signLicense(licenseData, input.privateKey));
    } catch (error) {
      this.#runtime.reportSigningFailure({
        organizationId: input.organizationId,
        error: error instanceof Error ? error : new Error(String(error)),
      });
      throw error;
    }
  }

  /** Whether one limit still admits another resource, for this caller. */
  checkLimit(input: LicenseLimitCheck): Promise<LimitCheckResult> {
    return this.#runtime.checkLimit(input);
  }

  /**
   * A client pre-check refused somebody. The limit is re-checked here, so a
   * fabricated report raises nothing, and the notification is neither awaited
   * nor allowed to fail the call: an unsent alert is operations' problem.
   */
  async reportLimitBlocked(input: LicenseLimitCheck): Promise<void> {
    const result = await this.#runtime.checkLimit(input);

    if (result.allowed) return;

    void this.#runtime
      .notifyLimitReached({
        organizationId: input.organizationId,
        limitType: input.limitType,
        current: result.current,
        max: result.max,
      })
      .catch((error: unknown) => this.reportError(error));
  }

  /**
   * Every enforced limit at once, keyed by limit type. Which limits "every limit" means is the
   * plan's business, not a door's: a screen that enumerated them itself would go stale the day
   * a limit is added, and silently show one fewer.
   */
  async checkAllLimits(
    input: Readonly<{ organizationId: string; user: LicensingCaller }>,
  ): Promise<Record<LimitType, LimitCheckResult>> {
    const results = await Promise.all(
      limitTypes.map((limitType) =>
        this.#runtime.checkLimit({
          organizationId: input.organizationId,
          limitType,
          user: input.user,
        }),
      ),
    );
    return Object.fromEntries(
      results.map((result: LimitCheckResult) => [result.limitType, result]),
    ) as Record<LimitType, LimitCheckResult>;
  }

  /** Swallows a notification failure into the process's error channel. */
  reportError(error: unknown): void {
    this.#runtime.reportError(error instanceof Error ? error : new Error(String(error)));
  }

  inspectPlatformAccess(input: { instanceLicenseKey?: string | undefined }) {
    return this.#service.inspectPlatformAccess(input);
  }

  getActivePlan(organizationId: string) {
    return this.#service.getActivePlan(organizationId);
  }

  getSelfHostedPlan(organizationId: string) {
    return this.#service.getSelfHostedPlan(organizationId);
  }

  validateAndStoreLicense(input: { organizationId: string; licenseKey: string }) {
    return this.#service.validateAndStoreLicense(input);
  }
}
