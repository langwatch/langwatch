import type { RestIdentity } from "@langwatch/api/rest";
/**
 * The licensing feature's application: what both of its doors call. It holds every service and
 * port the feature's api files reach, and it is the one typed thing a transport is given.
 */
import {
  LicensingApi,
  type ActivationCodePage,
  type ActivationCodeView,
  type ActivationAnswer,
  type ConnectPresentedCredential,
  type LicenseSyncAnswer,
  type LicenseSyncBody,
  type IssueActivationCodeInput,
  type IssuedActivationCode,
  type LicensingApi as LicensingApiContract,
  licenseValidationError,
  limitTypes,
  type LicenseLimitCheck,
  type LicensingCaller,
  type LimitCheckResult,
  type LimitType,
  type ConnectClassifyAnswer,
  type ConnectCredentialResolution,
  type ConnectedSeats,
  type ConnectDeploymentView,
  type ConnectService,
  type ConnectStatus,
  type InstanceIdentityView,
  type ContractTerms,
  type HostedCapAnswer,
  type HostedCaller,
  type HostedClassifyAnswer,
  type HostedUsageAnswer,
  type IncomingUsageReport,
  type SelfHostedInstanceDetail,
  type SelfHostedInstancePage,
  type SelfHostedSignal,
  type IssueLicenseInput,
  type IssuedLicenseView,
  type LicenseRefreshOutcome,
  type IssuedLicenseSource,
  type LicenseTermsInput,
  type LicensingServerConfig,
  type SsoGateStatus,
  licensingConfig,
  licensingSecrets,
  type PlatformLicenseAccess,
  type RemoveLicenseResult,
  type IssuedLicensePage,
  type LicenseStatus,
  type PlanInfo,
  type SeatChangeResult,
  type SignedIssuedLicense,
  type StoreLicenseResult,
} from "@langwatch/enterprise-licensing-contract";
import type { ResolvePlanInput } from "@langwatch/entitlement-contract";
import { PrismaUsageMembershipRepository } from "@langwatch/entitlement-process";
import { GatewayApi } from "@langwatch/gateway-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { nowInstant, Temporal } from "@langwatch/time";

import { HttpConnectGatewayChannel } from "../channels/http/http.connect-gateway.channel.ts";
import { HttpConnectLicenseChannel } from "../channels/http/http.connect-license.channel.ts";
import {
  type ConnectOrganizationDatabase,
  PrismaConnectOrganizationRepository,
} from "../repositories/prisma/prisma.connect-organization.repository.ts";
import {
  type InstanceIdentityDatabase,
  PrismaInstanceIdentityRepository,
} from "../repositories/prisma/prisma.instance-identity.repository.ts";
import { PrismaOrganizationLicenseRepository } from "../repositories/prisma/prisma.organization-license.repository.ts";
import { ActivationCodeService } from "../services/activation-code.service.ts";
import { ConnectCredentialService } from "../services/connect-credential.service.ts";
import { ConnectInstallService } from "../services/connect-install.service.ts";
import { ConnectSpendBufferService } from "../services/connect-spend-buffer.service.ts";
import { ContractBudgetService } from "../services/contract-budget.service.ts";
import { HostedServicesService } from "../services/hosted-services.service.ts";
import { InstanceIdentityService } from "../services/instance-identity.service.ts";
import { LicenseGenerationService } from "../services/license-generation.service.ts";
import { LicenseRefreshService } from "../services/license-refresh.service.ts";
import { LicenseRegistryService } from "../services/license-registry.service.ts";
import { LicenseSyncService } from "../services/license-sync.service.ts";
import { LicenseService, LicenseServiceConfiguration } from "../services/license.service.ts";
import { LicensingEntitlementSourceService } from "../services/licensing-entitlement-source.service.ts";
import { LicensingInfrastructureService } from "../services/licensing-infrastructure.service.ts";
import { NodeLicenseCryptographyService } from "../services/node-license-cryptography.service.ts";
import { SelfHostedCrmService } from "../services/self-hosted-crm.service.ts";
import { SelfHostedInstanceService } from "../services/self-hosted-instance.service.ts";
import type {
  ConnectInstallInfrastructure,
  HostedServicesInfrastructure,
  LicenseCryptography,
  SelfHostedInstancesInfrastructure,
  LicenseLogger,
  LicenseRegistryInfrastructure,
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
  /**
   * The license registry (ADR-156). Only LangWatch Cloud composes one; an
   * install has no licenses to issue, and its operations refuse by name.
   */
  registry?: LicenseRegistryInfrastructure;
  /**
   * The hosted end of Connect (ADR-156, section 5). Only LangWatch Cloud
   * composes one; everywhere else the hosted operations refuse by name.
   */
  hosted?: HostedServicesInfrastructure;
  /** The registry of self-hosted installs (ADR-156, section 10), on Cloud only. */
  instances?: SelfHostedInstancesInfrastructure;
  /**
   * The install end of Connect (ADR-156, section 9). Every deployment has one;
   * it is derived from the process's own stores where nothing supplies it.
   */
  connect?: ConnectInstallInfrastructure;
}>;

export type LicensingRuntime = Readonly<
  Omit<
    LicensingInfrastructure,
    | "repository"
    | "usage"
    | "retention"
    | "logger"
    | "registry"
    | "hosted"
    | "instances"
    | "connect"
  >
>;

/**
 * Production supplies the closed members and the app derives its own
 * infrastructure; `infrastructure` is the test-only fabric seam.
 */
type LicensingProcessMembers = Readonly<{ isSaas: boolean; serviceVersion: string }> &
  (
    | (MembersRead<readonly ["prisma", "logger"]> & { infrastructure?: never })
    | Readonly<{ prisma?: never; logger?: LicenseLogger; infrastructure: LicensingInfrastructure }>
  );

type LicensingSetup = FeatureSetup<
  typeof LicensingApp.dependencies,
  LicensingProcessMembers,
  LicensingServerConfig
>;

export class LicensingApp implements LicensingApiContract {
  static readonly contract: typeof LicensingApi = LicensingApi;
  static readonly dependencies = {
    /** Where an install's hosted provider slot is kept: a gateway fact licensing writes. */
    gateway: GatewayApi,
  };
  static readonly config = licensingConfig;
  /** `LANGWATCH_LICENSE_KEY` has one owner: SSO's gate asks this module, never the secret. */
  static readonly secrets = { instanceLicenseKey: licensingSecrets.instanceLicenseKey } as const;
  /** `isSaas` and `serviceVersion` are the process's own facts, drilled in. */
  static readonly reads = [...reads("prisma", "logger"), "isSaas", "serviceVersion"] as const;

  readonly #service: LicenseService;
  readonly #entitlements: LicensingEntitlementSourceService;
  readonly #runtime: LicensingRuntime;
  readonly #registry: LicenseRegistryService;
  readonly #credentials: ConnectCredentialService;
  readonly #sync: LicenseSyncService;
  readonly #contractBudgets: ContractBudgetService;
  readonly #activation: ActivationCodeService;
  readonly #hosted: HostedServicesService;
  readonly #hostedSpend: ConnectSpendBufferService;
  readonly #hostedDoor: RestIdentity | undefined;
  readonly #instances: SelfHostedInstanceService;
  readonly #install: ConnectInstallService;
  readonly #identity: InstanceIdentityService;
  readonly #refresh: LicenseRefreshService;
  readonly #isSaas: boolean;

  private constructor({
    service,
    runtime,
    entitlements,
    registry,
    install,
    isSaas,
  }: {
    service: LicenseService;
    runtime: LicensingRuntime;
    entitlements: LicensingEntitlementSourceService;
    registry: LicenseRegistryParts;
    install: ConnectInstallParts;
    isSaas: boolean;
  }) {
    this.#isSaas = isSaas;
    this.#service = service;
    this.#entitlements = entitlements;
    this.#runtime = runtime;
    this.#registry = registry.registry;
    this.#credentials = registry.credentials;
    this.#sync = registry.sync;
    this.#contractBudgets = registry.contractBudgets;
    this.#activation = registry.activation;
    this.#hosted = registry.hosted;
    this.#hostedSpend = registry.spend;
    this.#hostedDoor = registry.door;
    this.#instances = registry.instances;
    this.#install = install.install;
    this.#identity = install.identity;
    this.#refresh = install.refresh;
  }

  static async create(setup: LicensingSetup): Promise<LicensingApp> {
    const instanceLicenseKey = await setup.secrets.into(
      LicensingApp.secrets.instanceLicenseKey,
      (value) => value,
    );
    return LicensingApp.#assemble(setup, instanceLicenseKey);
  }

  static #assemble(
    { members, config, resources, dependencies }: LicensingSetup,
    instanceLicenseKey: string | undefined,
  ): LicensingApp {
    const cryptography = NodeLicenseCryptographyService.create({ publicKey: config.publicKey });
    // Derived from the closed prisma member: the licence reads are live, the seat
    // counts are entitlement's own membership classification (peer, not owned
    // here), and the mutation/enforcement ports refuse by name until a process
    // composes them.
    const partial = LicensingInfrastructureService.create({ processName: "this process" });
    const infrastructure =
      members.infrastructure !== undefined
        ? members.infrastructure
        : partial.withoutMutation({
            licenses: PrismaOrganizationLicenseRepository.create(members.prisma),
            ...seatCountsOverPrisma(members.prisma),
          });
    const {
      repository,
      usage,
      retention,
      logger,
      registry,
      hosted,
      instances,
      connect,
      ...runtime
    } = infrastructure;
    const registryParts = licenseRegistryParts({
      infrastructure: registry ?? partial.unavailableRegistry(),
      hosted: hosted ?? partial.unavailableHostedServices(),
      instances: instances ?? partial.unavailableSelfHostedInstances(),
      cryptography,
      logger: logger ?? members.logger,
    });
    const service = LicenseService.create({
      repository,
      cryptography,
      usage,
      retention,
      logger: logger ?? members.logger,
      configuration: LicenseServiceConfiguration.create(),
      instanceLicenseKey,
    });
    const app = new LicensingApp({
      service,
      runtime,
      entitlements: LicensingEntitlementSourceService.create({
        licensing: service,
        mode: members.isSaas ? "cloud" : "self-hosted",
      }),
      registry: registryParts,
      install: connectInstallParts({
        infrastructure:
          connect ??
          (members.prisma
            ? connectInstallOverPrisma({
                database: members.prisma,
                gateway: dependencies.gateway,
                config,
                cryptography,
                version: members.serviceVersion,
                instanceLicenseKey,
              })
            : unavailableConnectInstall({ version: members.serviceVersion })),
        cryptography,
        seats: repository,
        licenses: service,
        config,
        logger: logger ?? members.logger,
      }),
      isSaas: members.isSaas,
    });
    // Hosted spend a gateway reported but the buffer has not written yet is written at shutdown.
    resources.own("hosted-service spend buffer", () => app.flushHostedSpend());
    return app;
  }

  resolve(input: ResolvePlanInput): Promise<PlanInfo> {
    return this.#entitlements.resolve(input);
  }

  /** The license an organization is running on, its plan and its usage. */
  getLicenseStatus(organizationId: string): Promise<LicenseStatus> {
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

  isPlatformSsoLicensed(): Promise<boolean> {
    return this.#service.isPlatformSsoLicensed({ isSaas: this.#isSaas });
  }

  /**
   * Validates a pasted key and stores it, answering the plan it grants.
   */
  async uploadLicense(
    input: Readonly<{ organizationId: string; licenseKey: string }>,
  ): Promise<PlanInfo> {
    const result = await this.#service.validateAndStoreLicense({
      organizationId: input.organizationId,
      licenseKey: input.licenseKey,
    });

    if (!result.success) throw licenseValidationError(result.error);
    await this.#install.publishUpstream(input.organizationId);

    return result.planInfo;
  }

  /** Redeems an activation code with LangWatch and stores the license it minted. */
  async activateLicenseWithCode(input: {
    organizationId: string;
    code: string;
  }): Promise<PlanInfo> {
    const { licenseKey } = await this.#refresh.redeemActivationCode({ code: input.code });
    return this.uploadLicense({ organizationId: input.organizationId, licenseKey });
  }

  /** Drops the key, returning the organization to the free tier. */
  async removeLicense(organizationId: string): Promise<RemoveLicenseResult> {
    const removed = await this.#service.removeLicense(organizationId);
    await this.#install.publishUpstream(organizationId);
    return removed;
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

  inspectPlatformAccess(): Promise<PlatformLicenseAccess> {
    return this.#service.inspectPlatformAccess();
  }

  getActivePlan(organizationId: string): Promise<PlanInfo> {
    return this.#service.getActivePlan(organizationId);
  }

  getSelfHostedPlan(organizationId: string): Promise<PlanInfo> {
    return this.#service.getSelfHostedPlan(organizationId);
  }

  validateAndStoreLicense(input: {
    organizationId: string;
    licenseKey: string;
  }): Promise<StoreLicenseResult> {
    return this.#service.validateAndStoreLicense(input);
  }

  /** The license registry (ADR-156). Composed on LangWatch Cloud alone. */
  issueLicense(input: IssueLicenseInput): Promise<SignedIssuedLicense> {
    return this.#registry.issue({
      ...input,
      expiresAt: Temporal.Instant.from(input.expiresAt),
    });
  }

  recordIssuedLicense(input: {
    licenseKey: string;
    source: Extract<IssuedLicenseSource, "PURCHASE" | "SCRIPT">;
    organizationId?: string;
  }): Promise<IssuedLicenseView> {
    return this.#registry.record(input);
  }

  registerLegacyLicense(input: {
    licenseKey: string;
    organizationId: string;
    operatorId: string;
  }): Promise<IssuedLicenseView> {
    return this.#registry.registerLegacy(input);
  }

  revokeIssuedLicense(input: {
    id: string;
    operatorId: string;
    reason: string;
  }): Promise<IssuedLicenseView> {
    return this.#registry.revoke(input);
  }

  reissueLicense(input: {
    id: string;
    maxMembers?: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    expiresAt: string;
    operatorId: string;
  }): Promise<SignedIssuedLicense> {
    return this.#registry.reissue({
      ...input,
      expiresAt: Temporal.Instant.from(input.expiresAt),
    });
  }

  changeLicenseSeats(input: {
    id: string;
    maxMembers: number;
    operatorId: string;
  }): Promise<SeatChangeResult> {
    return this.#registry.changeSeats(input);
  }

  resetLicenseInstanceBinding(input: { id: string }): Promise<IssuedLicenseView> {
    return this.#registry.resetInstanceBinding(input);
  }

  updateLicenseTerms(
    input: { id: string; operatorId: string } & LicenseTermsInput,
  ): Promise<IssuedLicenseView> {
    return this.#registry.updateTerms(input);
  }

  linkLicenseToOrganization(input: {
    id: string;
    organizationId: string;
    operatorId: string;
  }): Promise<IssuedLicenseView> {
    return this.#registry.linkToOrganization(input);
  }

  getIssuedLicense(input: { id: string }): Promise<IssuedLicenseView> {
    return this.#registry.getById(input);
  }

  listIssuedLicenses(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<IssuedLicensePage> {
    return this.#registry.list(input);
  }

  /** The grant a hosted route acts on, which never carries the row itself. */
  async resolveConnectCredential(input: {
    token: string;
    instanceId: string | null | undefined;
  }): Promise<ConnectCredentialResolution> {
    const outcome = await this.#credentials.resolve(input);
    if (!outcome.ok) return outcome;
    const { license } = outcome;
    return {
      ok: true,
      grant: {
        licenseRowId: license.id,
        licenseId: license.licenseId,
        organizationId: license.organizationId,
        instanceId: license.instanceId,
        virtualKeyId: outcome.virtualKeyId,
        services: license.services,
        commitUsdCents: license.commitUsdCents,
        overageEnabled: license.overageEnabled,
        overageMaxUsdCents: license.overageMaxUsdCents,
      },
    };
  }

  recordLicenseSync(
    input: ConnectPresentedCredential & { body: LicenseSyncBody },
  ): Promise<LicenseSyncAnswer> {
    return this.#sync.answer(input);
  }

  /** The install end of Connect (ADR-156, section 9). */
  getConnectStatus(input: { organizationId: string }): Promise<ConnectStatus> {
    return this.#install.getStatus(input.organizationId);
  }

  findEnabledConnectServices(input: { organizationId: string }): Promise<ConnectService[]> {
    return this.#install.findEnabledServices(input.organizationId);
  }

  setConnectService(input: {
    organizationId: string;
    service: string;
    enabled: boolean;
  }): Promise<{ enabledServices: ConnectService[] }> {
    return this.#install.setService(input);
  }

  setConnectCap(input: {
    organizationId: string;
    capUsd: number;
  }): Promise<{ capUsd: number; maximumCapUsd: number }> {
    return this.#install.setCap(input);
  }

  getInstanceId(): Promise<string> {
    return this.#identity.getInstanceId();
  }

  async syncLicenses(): Promise<void> {
    const organizationIds = await this.#install.findLicensedOrganizationIds();
    await this.#refresh.syncAll(organizationIds);
    for (const organizationId of organizationIds) {
      await this.#install.publishUpstream(organizationId);
    }
  }

  findInstanceIdentity(): Promise<InstanceIdentityView[]> {
    return this.#identity.findView();
  }

  getConnectDeployment(): Promise<ConnectDeploymentView> {
    return this.#install.getDeployment();
  }

  recordUsageReportOutcome({ error }: { error?: string }): Promise<void> {
    return this.#identity.recordReport({ error: error ?? null, at: nowInstant() });
  }

  setUsageReportSwitches(input: {
    optionalMetricsOptOut?: boolean;
    hostnameOptOut?: boolean;
  }): Promise<void> {
    return this.#identity.setReportSwitches(input);
  }

  acknowledgeStartupNotice({ schemaVersion }: { schemaVersion: number }): Promise<void> {
    return this.#identity.acknowledgeStartupNotice(schemaVersion);
  }

  isConnectServiceEnabled(input: {
    organizationId: string;
    service: ConnectService;
  }): Promise<boolean> {
    return this.#install.isServiceEnabled(input);
  }

  classifyThroughConnect(input: {
    organizationId: string;
    text: string;
    questions: readonly unknown[];
  }): Promise<ConnectClassifyAnswer> {
    return this.#install.classify(input);
  }

  refreshLicense(input: { organizationId: string }): Promise<LicenseRefreshOutcome> {
    return this.#refresh.refresh(input.organizationId);
  }

  /** The hosted end of Connect (ADR-156, section 5), on LangWatch Cloud. */
  classifyForHostedCaller(input: {
    caller: HostedCaller;
    payload: unknown;
  }): Promise<HostedClassifyAnswer> {
    return this.#hosted.classify(input);
  }

  getHostedUsage(input: { caller: HostedCaller }): Promise<HostedUsageAnswer> {
    return this.#hosted.usage(input);
  }

  setHostedBudgetCap(input: { caller: HostedCaller; payload: unknown }): Promise<HostedCapAnswer> {
    return this.#hosted.setBudget(input);
  }

  getContractTerms(input: { organizationId: string }): Promise<ContractTerms> {
    return this.#contractBudgets.termsOf(input.organizationId);
  }

  getConnectedSeats(input: { organizationId: string }): Promise<ConnectedSeats> {
    return this.#registry.getConnectedSeats(input.organizationId);
  }

  raiseContractCommit(input: {
    organizationId: string;
    byUsdCents: number;
    operatorId: string;
  }): Promise<IssuedLicenseView> {
    return this.#registry.raiseCommit(input);
  }

  syncContractBudget(input: { organizationId: string; operatorId: string }): Promise<void> {
    return this.#contractBudgets.sync(input);
  }

  resetContractBudget(input: { organizationId: string; operatorId: string }): Promise<void> {
    return this.#contractBudgets.reset(input);
  }

  findConnectServicesForManagedKey(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<ConnectService[]> {
    return this.#credentials.findEntitledServices(input);
  }

  /** Activation codes (ADR-156, section 5). */
  issueActivationCode(input: IssueActivationCodeInput): Promise<IssuedActivationCode> {
    return this.#activation.issue(input);
  }

  listActivationCodes(input: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<ActivationCodePage> {
    return this.#activation.list(input);
  }

  revokeActivationCode(input: { id: string; operatorId: string }): Promise<ActivationCodeView> {
    return this.#activation.revoke(input);
  }

  redeemActivationCode(input: ConnectPresentedCredential): Promise<ActivationAnswer> {
    return this.#activation.answer(input);
  }

  recordUsageReport(input: IncomingUsageReport): Promise<SelfHostedSignal[]> {
    return this.#instances.recordReport(input);
  }

  listSelfHostedInstances(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<SelfHostedInstancePage> {
    return this.#instances.list(input);
  }

  getSelfHostedInstance(input: { id: string }): Promise<SelfHostedInstanceDetail> {
    return this.#instances.getById(input);
  }

  /** Writes hosted spend the buffer still holds. Called by the drain. */
  flushHostedSpend(): Promise<void> {
    return this.#hostedSpend.flush();
  }

  /** The signed door the hosted Connect family answers behind. */
  get hostedDoor(): RestIdentity {
    return (
      this.#hostedDoor ??
      LicensingInfrastructureService.create({
        processName: "this process",
      }).unavailableHostedServices().door
    );
  }
}

/** What the registry and the hosted routes resolve to together. */
type LicenseRegistryParts = Readonly<{
  registry: LicenseRegistryService;
  credentials: ConnectCredentialService;
  sync: LicenseSyncService;
  contractBudgets: ContractBudgetService;
  activation: ActivationCodeService;
  hosted: HostedServicesService;
  spend: ConnectSpendBufferService;
  door: RestIdentity | undefined;
  instances: SelfHostedInstanceService;
}>;

function licenseRegistryParts({
  infrastructure,
  hosted,
  instances,
  cryptography,
  logger,
}: {
  infrastructure: LicenseRegistryInfrastructure;
  hosted: HostedServicesInfrastructure;
  instances: SelfHostedInstancesInfrastructure;
  cryptography: LicenseCryptography;
  logger?: LicenseLogger;
}): LicenseRegistryParts {
  const now = () => nowInstant();
  const contractBudgets = ContractBudgetService.create({
    store: hosted.budgets,
    licensesOf: (organizationId) => infrastructure.repository.findAllByOrganization(organizationId),
    systemActorId: infrastructure.systemActorId,
    now,
  });
  const spend = ConnectSpendBufferService.create({
    recorder: hosted.spend,
    ...(logger ? { logger } : {}),
    now,
  });
  const credentials = ConnectCredentialService.create({
    repository: infrastructure.repository,
    managedKeys: infrastructure.managedKeys,
    cryptography,
    systemActorId: infrastructure.systemActorId,
    now,
  });
  const registry = LicenseRegistryService.create({
    repository: infrastructure.repository,
    organizations: infrastructure.organizations,
    managedKeys: infrastructure.managedKeys,
    contractBudgets,
    seatBilling: infrastructure.seatBilling,
    cryptography,
    generation: LicenseGenerationService.create(cryptography),
    cipher: infrastructure.cipher,
    signingKey: infrastructure.signingKey,
    now,
  });
  return {
    credentials,
    contractBudgets,
    registry,
    spend,
    door: hosted.door,
    instances: SelfHostedInstanceService.create({
      repository: instances.repository,
      licenses: infrastructure.repository,
      organizations: infrastructure.organizations,
      optionalReportKeys: instances.optionalReportKeys,
      ...(instances.leads
        ? {
            crm: SelfHostedCrmService.create({ ...instances.leads, ...(logger ? { logger } : {}) }),
          }
        : {}),
      now,
    }),
    activation: ActivationCodeService.create({
      repository: infrastructure.activationCodes,
      licenses: registry,
      credentials: {
        resolve: (input) => credentials.resolve(input),
        tokenOf: (licenseKey) => cryptography.getLicenseToken(licenseKey),
      },
      rateLimit: infrastructure.activationRateLimit,
      systemActorId: infrastructure.systemActorId,
      now,
    }),
    hosted: HostedServicesService.create({
      licenses: infrastructure.repository,
      judge: hosted.judge,
      spend,
      usage: hosted.usage,
      contractBudgets,
      now,
    }),
    sync: LicenseSyncService.create({
      credentials,
      repository: infrastructure.repository,
      managedKeys: infrastructure.managedKeys,
      rateLimit: infrastructure.syncRateLimit,
      cipher: infrastructure.cipher,
      systemActorId: infrastructure.systemActorId,
      now,
    }),
  };
}

/** Both tables the install end reads, over one connection. */
type ConnectInstallDatabase = ConnectOrganizationDatabase & InstanceIdentityDatabase;

/** The three services the install end of Connect resolves to. */
type ConnectInstallParts = Readonly<{
  install: ConnectInstallService;
  identity: InstanceIdentityService;
  refresh: LicenseRefreshService;
}>;

/**
 * The install end derived from the process's own stores. Every deployment has
 * these two tables; whether anything is called is decided by the license and by
 * `LANGWATCH_CONNECT_DISABLED`, never by whether a client was composed.
 */
function connectInstallOverPrisma({
  database,
  gateway,
  config,
  cryptography,
  version,
  instanceLicenseKey,
}: {
  database: ConnectInstallDatabase;
  gateway: Pick<GatewayApi, "setConnectUpstreamInternal" | "clearConnectUpstreamInternal">;
  config: LicensingServerConfig;
  cryptography: LicenseCryptography;
  version: string;
  instanceLicenseKey: string | undefined;
}): ConnectInstallInfrastructure {
  const permitted = config.connectDisabled !== true;
  return {
    organizations: PrismaConnectOrganizationRepository.create(database),
    identity: PrismaInstanceIdentityRepository.create(database),
    ...(permitted
      ? {
          gateway: HttpConnectGatewayChannel.create({
            endpoint: config.connectGatewayEndpoint,
          }),
          licenseHost: HttpConnectLicenseChannel.create({
            endpoint: config.connectLicenseEndpoint,
          }),
        }
      : {}),
    upstream: {
      set: (slot) => gateway.setConnectUpstreamInternal(slot),
      clear: (slot) => gateway.clearConnectUpstreamInternal(slot),
    },
    instanceLicenseKey: () => instanceLicenseKey,
    newInstanceId: () => cryptography.generateInstanceId(),
    version: () => version,
    ...(config.connectInstanceId ? { instanceIdOverride: config.connectInstanceId } : {}),
  };
}

/** What a process composing no stores answers: no identity, and no call out. */
function unavailableConnectInstall({ version }: { version: string }): ConnectInstallInfrastructure {
  const unavailable = () => new Error("this process composes no install-side Connect");
  return {
    organizations: {
      findById: () => Promise.resolve(null),
      findLicensedOrganizationIds: () => Promise.resolve([]),
      setServicesDisabled: () => Promise.reject(unavailable()),
      recordSyncOutcome: () => Promise.reject(unavailable()),
    },
    identity: {
      findRow: () => Promise.resolve(null),
      mint: () => Promise.reject(unavailable()),
      acknowledgeStartupNotice: () => Promise.reject(unavailable()),
      setReportSwitches: () => Promise.reject(unavailable()),
      recordReport: () => Promise.reject(unavailable()),
    },
    instanceLicenseKey: () => void 0,
    newInstanceId: () => {
      throw unavailable();
    },
    version: () => version,
  };
}

function connectInstallParts({
  infrastructure,
  cryptography,
  seats,
  licenses,
  config,
  logger,
}: {
  infrastructure: ConnectInstallInfrastructure;
  cryptography: LicenseCryptography;
  seats: LicenseStorage;
  licenses: LicenseService;
  config: LicensingServerConfig;
  logger?: LicenseLogger;
}): ConnectInstallParts {
  const identity = InstanceIdentityService.create({
    repository: infrastructure.identity,
    newInstanceId: infrastructure.newInstanceId,
    ...(infrastructure.instanceIdOverride
      ? { instanceIdOverride: infrastructure.instanceIdOverride }
      : {}),
  });
  const install = ConnectInstallService.create({
    organizations: infrastructure.organizations,
    identity,
    cryptography,
    deployment: {
      permitted: config.connectDisabled !== true,
      gatewayEndpoint: config.connectGatewayEndpoint,
      licenseEndpoint: config.connectLicenseEndpoint,
    },
    ...(infrastructure.gateway ? { gateway: infrastructure.gateway } : {}),
    instanceLicenseKey: infrastructure.instanceLicenseKey,
    ...(config.publicKey ? { publicKey: config.publicKey } : {}),
    ...(infrastructure.upstream ? { upstream: infrastructure.upstream } : {}),
  });
  return {
    identity,
    install,
    refresh: LicenseRefreshService.create({
      instanceId: () => identity.getInstanceId(),
      install,
      organizations: infrastructure.organizations,
      seats,
      licenses,
      cryptography,
      ...(infrastructure.licenseHost ? { host: infrastructure.licenseHost } : {}),
      version: infrastructure.version,
      now: () => nowInstant(),
      ...(logger ? { logger: { warn: (fields, message) => logger.error(fields, message) } } : {}),
    }),
  };
}
