import { SYSTEM_ACTORS } from "@langwatch/actor";
import {
  LicenseGenerationService,
  NodeLicenseCryptographyService,
  type LicenseCryptography,
} from "@langwatch/enterprise-license-signing";
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
  type ConnectClassifyAnswer,
  type ConnectCredentialResolution,
  type ConnectedSeats,
  type ConnectDeploymentView,
  type DomainClaimLicenseAuthority,
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
  type LicenseSeatChange,
  type SeatChangeResult,
  type SignedIssuedLicense,
  type StoreLicenseResult,
  type GenerateLicenseKeyInput,
  LicenseSigningNotConfiguredError,
  type GenerateLicenseOutput,
  detectLicenseInputForm,
} from "@langwatch/enterprise-licensing-contract";
import type { EntitlementGrant, ResolvePlanInput } from "@langwatch/entitlement-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { optionalUsageReportKeys } from "@langwatch/ops-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import {
  type Encryption,
  type MembersRead,
  type RateLimiter,
} from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { nowInstant, Temporal } from "@langwatch/time";

import { HttpConnectGatewayChannel } from "../channels/http/http.connect-gateway.channel.ts";
import { HttpConnectLicenseChannel } from "../channels/http/http.connect-license.channel.ts";
import {
  type ActivationCodeDatabase,
  PrismaActivationCodeRepository,
} from "../repositories/prisma/prisma.activation-code.repository.ts";
import {
  type ConnectOrganizationDatabase,
  PrismaConnectOrganizationRepository,
} from "../repositories/prisma/prisma.connect-organization.repository.ts";
import {
  type InstanceIdentityDatabase,
  PrismaInstanceIdentityRepository,
} from "../repositories/prisma/prisma.instance-identity.repository.ts";
import {
  type IssuedLicenseDatabase,
  PrismaIssuedLicenseRepository,
} from "../repositories/prisma/prisma.issued-license.repository.ts";
import { PrismaOrganizationLicenseRepository } from "../repositories/prisma/prisma.organization-license.repository.ts";
import {
  PrismaSelfHostedInstanceRepository,
  type SelfHostedInstanceDatabase,
} from "../repositories/prisma/prisma.self-hosted-instance.repository.ts";
import { ACTIVATION_ATTEMPTS_LIMIT } from "../rules/activation-code.rules.ts";
import { LICENSE_SYNCS_LIMIT } from "../rules/issued-license.rules.ts";
import { ActivationCodeService } from "../services/activation-code.service.ts";
import {
  type ConfiguredActivationLogger,
  ConfiguredActivationService,
  type ConfiguredActivationOutcome,
} from "../services/configured-activation.service.ts";
import { ConnectCredentialService } from "../services/connect-credential.service.ts";
import { ConnectInstallService } from "../services/connect-install.service.ts";
import { ConnectSpendBufferService } from "../services/connect-spend-buffer.service.ts";
import { ContractBudgetStoreService } from "../services/contract-budget-store.service.ts";
import { ContractBudgetService } from "../services/contract-budget.service.ts";
import { DomainClaimAuthorityService } from "../services/domain-claim-authority.service.ts";
import { HostedServicesService } from "../services/hosted-services.service.ts";
import { HostedUsageReaderService } from "../services/hosted-usage-reader.service.ts";
import { InstanceIdentityService } from "../services/instance-identity.service.ts";
import { LicenseRefreshService } from "../services/license-refresh.service.ts";
import { LicenseRegistryService } from "../services/license-registry.service.ts";
import { LicenseSyncService } from "../services/license-sync.service.ts";
import { LicenseService, LicenseServiceConfiguration } from "../services/license.service.ts";
import { LicensingEntitlementSourceService } from "../services/licensing-entitlement-source.service.ts";
import { LicensingInfrastructureService } from "../services/licensing-infrastructure.service.ts";
import { SelfHostedCrmService } from "../services/self-hosted-crm.service.ts";
import { SelfHostedInstanceService } from "../services/self-hosted-instance.service.ts";
import type {
  ConnectInstallInfrastructure,
  LicenseCustomers,
  HostedServicesInfrastructure,
  SelfHostedInstancesInfrastructure,
  LicenseLogger,
  LicenseRegistryInfrastructure,
  LicenseRetention,
  LicenseStorage,
  LicenseUsage,
} from "./licensing.members.ts";

/** Seat counts are organization's: one peer read, the same count its own seat checks use. */
function seatCountsOver(
  organizations: Pick<OrganizationApi, "countMemberSeats">,
): Pick<LicensingInfrastructure["repository"], "getMemberCount" | "getMembersLiteCount"> {
  return {
    getMemberCount: async (organizationId) =>
      (await organizations.countMemberSeats({ organizationId })).fullMembers,
    getMembersLiteCount: async (organizationId) =>
      (await organizations.countMemberSeats({ organizationId })).liteMembers,
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
  /**
   * The license registry (ADR-156). Only LangWatch Cloud composes one; an
   * install has no licenses to issue, and its operations refuse by name.
   */
  registry?: LicenseRegistryInfrastructure;
  /**
   * The hosted end of Connect (ADR-156, section 5), composed from its owners on
   * every deployment; each licence's entitlements still gate its services.
   */
  hosted?: HostedServicesInfrastructure;
  /** The registry of self-hosted installs (ADR-156, section 10); else derived from the stores. */
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
    | (MembersRead<readonly ["prisma", "logger", "encryption", "rateLimiter"]> & {
        infrastructure?: never;
      })
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
    /** Whose memberships a licence's seats are counted from. */
    organizations: OrganizationApi,
    /** The judge a hosted classify call reaches, its price, and where its spend is recorded. */
    instantEval: InstantEvalApi,
    /** Whose team a hosted caller's project belongs to, for the budgets that apply to it. */
    projects: ProjectApi,
  };
  static readonly config = licensingConfig;
  /**
   * Each secret has one owner: SSO's gate asks this module for `LANGWATCH_LICENSE_KEY`, and
   * every licence LangWatch issues is signed here with `LANGWATCH_LICENSE_PRIVATE_KEY`.
   */
  static readonly secrets = {
    instanceLicenseKey: licensingSecrets.instanceLicenseKey,
    licensePrivateKey: licensingSecrets.licensePrivateKey,
  } as const;
  /** `isSaas` and `serviceVersion` are the process's own facts, drilled in. */
  static readonly reads = [
    "prisma",
    "logger",
    "encryption",
    "rateLimiter",
    "isSaas",
    "serviceVersion",
  ] as const;

  readonly #service: LicenseService;
  readonly #entitlements: LicensingEntitlementSourceService;
  readonly #runtime: LicensingRuntime;
  readonly #registry: LicenseRegistryService;
  readonly #generation: LicenseGenerationService;
  readonly #credentials: ConnectCredentialService;
  readonly #sync: LicenseSyncService;
  readonly #contractBudgets: ContractBudgetService;
  readonly #activation: ActivationCodeService;
  readonly #hosted: HostedServicesService;
  readonly #hostedSpend: ConnectSpendBufferService;
  readonly #instances: SelfHostedInstanceService;
  readonly #install: ConnectInstallService;
  readonly #identity: InstanceIdentityService;
  readonly #refresh: LicenseRefreshService;
  readonly #isSaas: boolean;
  readonly #signingKey: string | undefined;
  readonly #domainClaims: DomainClaimAuthorityService;
  #configuredActivation: ConfiguredActivationService | undefined;

  private constructor({
    service,
    runtime,
    entitlements,
    registry,
    install,
    isSaas,
    generation,
    signingKey,
    domainClaims,
  }: {
    generation: LicenseGenerationService;
    domainClaims: DomainClaimAuthorityService;
    service: LicenseService;
    runtime: LicensingRuntime;
    entitlements: LicensingEntitlementSourceService;
    registry: LicenseRegistryParts;
    install: ConnectInstallParts;
    isSaas: boolean;
    signingKey: string | undefined;
  }) {
    this.#isSaas = isSaas;
    this.#signingKey = signingKey;
    this.#domainClaims = domainClaims;
    this.#service = service;
    this.#entitlements = entitlements;
    this.#runtime = runtime;
    this.#registry = registry.registry;
    this.#generation = generation;
    this.#credentials = registry.credentials;
    this.#sync = registry.sync;
    this.#contractBudgets = registry.contractBudgets;
    this.#activation = registry.activation;
    this.#hosted = registry.hosted;
    this.#hostedSpend = registry.spend;
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
    const licensePrivateKey = await setup.secrets.into(
      LicensingApp.secrets.licensePrivateKey,
      (value) => value,
    );
    return LicensingApp.#assemble(setup, { instanceLicenseKey, licensePrivateKey });
  }

  static #assemble(
    { members, config, resources, dependencies }: LicensingSetup,
    {
      instanceLicenseKey,
      licensePrivateKey,
    }: { instanceLicenseKey: string | undefined; licensePrivateKey: string | undefined },
  ): LicensingApp {
    const cryptography = NodeLicenseCryptographyService.create({ publicKey: config.publicKey });
    // The variable takes a signed key or an activation code. A code is not a
    // license: it is redeemed at start and stored on an organization.
    const configured = detectLicenseInputForm(instanceLicenseKey);
    const signedInstanceKey = configured.form === "license_key" ? configured.licenseKey : undefined;
    // Derived from the closed prisma member: the licence rows are read and written
    // live, and the seat counts are organization's own membership classification
    // (a peer, not owned here).
    const partial = LicensingInfrastructureService.create({ processName: "this process" });
    const infrastructure =
      members.infrastructure !== undefined
        ? members.infrastructure
        : {
            ...partial.withStorage({
              licenses: PrismaOrganizationLicenseRepository.create(members.prisma),
              ...seatCountsOver(dependencies.organizations),
            }),
            registry: licenseRegistryOverPrisma({
              database: members.prisma,
              organizations: dependencies.organizations,
              gateway: dependencies.gateway,
              encryption: members.encryption,
              rateLimiter: members.rateLimiter,
              signingKey: licensePrivateKey,
            }),
            hosted: hostedServicesOverPeers(dependencies),
            instances: selfHostedInstancesOverPrisma({
              database: members.prisma,
              organizations: dependencies.organizations,
            }),
          };
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
      instanceLicenseKey: signedInstanceKey,
    });
    const connectInfrastructure =
      connect ??
      (members.prisma
        ? connectInstallOverPrisma({
            database: members.prisma,
            gateway: dependencies.gateway,
            config,
            cryptography,
            version: members.serviceVersion,
            instanceLicenseKey: signedInstanceKey,
          })
        : unavailableConnectInstall({ version: members.serviceVersion }));
    const app = new LicensingApp({
      generation: LicenseGenerationService.create(cryptography),
      service,
      runtime,
      entitlements: LicensingEntitlementSourceService.create({
        licensing: service,
        mode: members.isSaas ? "cloud" : "self-hosted",
      }),
      registry: registryParts,
      install: connectInstallParts({
        infrastructure: connectInfrastructure,
        cryptography,
        seats: repository,
        licenses: service,
        config,
        logger: logger ?? members.logger,
      }),
      isSaas: members.isSaas,
      signingKey: licensePrivateKey,
      domainClaims: DomainClaimAuthorityService.create({
        isSaas: members.isSaas,
        licenses: service,
        organizations: dependencies.organizations,
      }),
    });
    // Hosted spend a gateway reported but the buffer has not written yet is written at shutdown.
    resources.own("hosted-service spend buffer", () => app.flushHostedSpend());
    if (!members.isSaas && configured.form === "activation_code") {
      app.#configuredActivation = ConfiguredActivationService.create({
        configured,
        connectPermitted: config.connectDisabled !== true,
        findOrganizations: () => connectInfrastructure.organizations.findAllOldestFirst(),
        redeem: ({ code }) =>
          app.#refresh.redeemActivationCode({
            code,
            signal: AbortSignal.timeout(BOOT_REDEMPTION_TIMEOUT_MS),
          }),
        store: async ({ organizationId, licenseKey }) => {
          const result = await app.validateAndStoreLicense({ organizationId, licenseKey });
          if (!result.success) return { success: false, error: result.error };
          await app.#install.publishUpstream(organizationId);
          return { success: true };
        },
        isValidLicense: (licenseKey) => cryptography.validateLicense({ licenseKey }).valid,
        logger: activationLoggerOf(members.logger),
      });
      // Before the server listens, so the first request already sees the license.
      resources.ownService({
        name: "configured license activation",
        start: async () => {
          await app.activateConfiguredLicense();
        },
        stop: () => undefined,
      });
    }
    return app;
  }

  resolve(input: ResolvePlanInput): Promise<EntitlementGrant> {
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

  getDomainClaimAuthority(): Promise<DomainClaimLicenseAuthority> {
    return this.#domainClaims.getDomainClaimAuthority();
  }

  /**
   * Validates a pasted key and stores it, answering the plan it grants.
   */
  async uploadLicense(
    input: Readonly<{ organizationId: string; licenseKey: string }>,
  ): Promise<PlanInfo> {
    const result = await this.validateAndStoreLicense({
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

  /** Changes on every license this process stores or removes, so a gate can re-read at once. */
  async licenseRevision(): Promise<number> {
    return this.#service.licenseRevision();
  }

  /**
   * Redeems an activation code set as `LANGWATCH_LICENSE_KEY`, once: at start,
   * and again when the first organization is created. A no-op otherwise.
   */
  async activateConfiguredLicense(): Promise<ConfiguredActivationOutcome> {
    if (!this.#configuredActivation) return { outcome: "not_configured" };
    return this.#configuredActivation.activate();
  }

  /** The license registry (ADR-156). Composed on LangWatch Cloud alone. */
  issueLicense(input: IssueLicenseInput): Promise<SignedIssuedLicense> {
    return this.#registry.issue({
      ...input,
      expiresAt: Temporal.Instant.from(input.expiresAt),
    });
  }

  /** Signs with licensing's own key; a deployment without one refuses by name. */
  async generateLicenseKey(input: GenerateLicenseKeyInput): Promise<GenerateLicenseOutput> {
    const privateKey = this.#signingKey;
    if (!privateKey || privateKey.trim() === "") throw new LicenseSigningNotConfiguredError();
    return this.#generation.generate({ ...input, privateKey });
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
    signal?: AbortSignal;
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

  findSeatChanges(input: { organizationId?: string }): Promise<LicenseSeatChange[]> {
    return this.#registry.findSeatChanges(input);
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
}

/** A redemption at start gives up well before the transport's own timeout. */
const BOOT_REDEMPTION_TIMEOUT_MS = 15_000;

/** The process logger; a test fabric's error-only logger stays silent here. */
function activationLoggerOf(logger: unknown): ConfiguredActivationLogger {
  const candidate = logger as Partial<ConfiguredActivationLogger> | undefined;
  if (typeof candidate?.info === "function" && typeof candidate.warn === "function") {
    return candidate as ConfiguredActivationLogger;
  }
  return { info: () => undefined, warn: () => undefined };
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
    instances: SelfHostedInstanceService.create({
      repository: instances.repository,
      licenses: instances.licenses,
      organizations: instances.organizations,
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

/** The registry's own tables, over one connection. */
type LicenseRegistryDatabase = IssuedLicenseDatabase & ActivationCodeDatabase;

/**
 * The licence registry derived from the process's own stores, as main's
 * `registry/composition.ts` built it on every deployment. Billing reads the seat
 * changes it records through `findSeatChanges` (ARCHITECTURE.md section 9).
 */
function licenseRegistryOverPrisma({
  database,
  organizations,
  gateway,
  encryption,
  rateLimiter,
  signingKey,
}: {
  database: LicenseRegistryDatabase;
  organizations: Pick<
    OrganizationApi,
    "findProvisioningSummary" | "createSelfHostedCustomer" | "markSelfHostedCustomer"
  >;
  gateway: Pick<
    GatewayApi,
    | "provisionConnectManagedKey"
    | "revokeManagedInternal"
    | "invalidateManagedInternal"
    | "setManagedKeyConnectServicesInternal"
    | "setManagedKeyLicenseInternal"
  >;
  encryption: Encryption;
  rateLimiter: RateLimiter;
  signingKey: string | undefined;
}): LicenseRegistryInfrastructure {
  const systemActorId = SYSTEM_ACTORS.connectLicense;
  const allowed = async (key: string, limit: { requests: number; seconds: number }) =>
    (await rateLimiter.check(key, limit)).allowed;
  return {
    repository: PrismaIssuedLicenseRepository.create(database),
    organizations: {
      findById: customerLookup(organizations),
      createSelfHostedCustomer: ({ name }) => organizations.createSelfHostedCustomer({ name }),
      markSelfHostedCustomer: (organizationId) =>
        organizations.markSelfHostedCustomer({ organizationId }),
    },
    managedKeys: {
      provision: ({ organizationId, licenseId }) =>
        gateway.provisionConnectManagedKey({
          organizationId,
          licenseId,
          actorUserId: systemActorId,
        }),
      retire: (key) => gateway.revokeManagedInternal(key),
      invalidate: (key) => gateway.invalidateManagedInternal(key),
      setConnectServices: (key) => gateway.setManagedKeyConnectServicesInternal(key),
      setLicense: (key) => gateway.setManagedKeyLicenseInternal(key),
    },
    activationCodes: PrismaActivationCodeRepository.create(database),
    activationRateLimit: {
      allow: ({ codeHash }) => allowed(`activation_code:${codeHash}`, ACTIVATION_ATTEMPTS_LIMIT),
    },
    syncRateLimit: {
      allow: ({ licenseRowId }) => allowed(`license_sync:${licenseRowId}`, LICENSE_SYNCS_LIMIT),
    },
    cipher: encryption,
    signingKey: () => signingKey,
    systemActorId,
  };
}

/**
 * The hosted end of Connect composed from its owners, as main composed it on every deployment:
 * instant-eval judges, prices and records the spend, and the gateway keeps the budgets. The door
 * the family answers behind is the gateway's own, bound in licensing.server.ts.
 */
function hostedServicesOverPeers({
  gateway,
  instantEval,
  projects,
}: {
  gateway: Pick<
    GatewayApi,
    | "listBudgetsWithHealth"
    | "createBudget"
    | "updateBudget"
    | "resetBudget"
    | "findVirtualKeyById"
    | "resolveApplicableBudgets"
  >;
  instantEval: Pick<InstantEvalApi, "classify" | "priceOf" | "recordSpendForHostedCalls">;
  projects: Pick<ProjectApi, "findById">;
}): HostedServicesInfrastructure {
  return {
    budgets: ContractBudgetStoreService.create({ gateway }),
    usage: HostedUsageReaderService.create({ gateway, projects }),
    judge: {
      classify: (input, signal) =>
        instantEval.classify({ ...input, ...(signal ? { signal } : {}) }),
      priceOf: (input) => instantEval.priceOf(input),
    },
    spend: { recordSpend: (entry) => instantEval.recordSpendForHostedCalls(entry) },
  };
}

/** The customer's id and name, as the organization feature answers it. */
function customerLookup(
  organizations: Pick<OrganizationApi, "findProvisioningSummary">,
): LicenseCustomers["findById"] {
  return async (organizationId) => {
    const summary = await organizations.findProvisioningSummary(organizationId);
    return summary ? { id: summary.id, name: summary.name } : null;
  };
}

/** The install rows and the licences bound to them, over one connection. */
type SelfHostedInstancesDatabase = SelfHostedInstanceDatabase & IssuedLicenseDatabase;

/**
 * The instance registry derived from the process's own stores, as main built it on
 * every deployment: the rows from Postgres, the customer's name from its owner.
 */
function selfHostedInstancesOverPrisma({
  database,
  organizations,
}: {
  database: SelfHostedInstancesDatabase;
  organizations: Pick<OrganizationApi, "findProvisioningSummary">;
}): SelfHostedInstancesInfrastructure {
  return {
    repository: PrismaSelfHostedInstanceRepository.create(database),
    licenses: PrismaIssuedLicenseRepository.create(database),
    organizations: {
      findById: customerLookup(organizations),
    },
    optionalReportKeys: new Set(optionalUsageReportKeys()),
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
      findAllOldestFirst: () => Promise.resolve([]),
      setServicesDisabled: () => Promise.reject(unavailable()),
      recordSyncOutcome: () => Promise.reject(unavailable()),
    },
    identity: {
      findRow: () => Promise.resolve(null),
      mint: () => Promise.reject(unavailable()),
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
