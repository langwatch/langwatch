import { SYSTEM_ACTORS } from "@langwatch/authorization";
import { isReleaseBuild, releaseVersionOf } from "@langwatch/config";
import { parseOutboundProxyConfig } from "@langwatch/egress";
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
  type ConnectServiceState,
  type ConnectStatus,
  type InstanceIdentityView,
  type ContractTerms,
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
import type { EventingCommands } from "@langwatch/eventing";
import { GatewayApi } from "@langwatch/gateway-contract";
import { createLogger } from "@langwatch/observability";
import { optionalUsageReportKeys } from "@langwatch/ops-contract";
import type { FeatureSetup } from "@langwatch/process";
import { nowInstant, Temporal } from "@langwatch/time";

import type { ConnectGatewayChannel } from "../channels/connect-gateway.channel.ts";
import type { ConnectLicenseChannel } from "../channels/connect-license.channel.ts";
import { HttpConnectGatewayChannel } from "../channels/http/http.connect-gateway.channel.ts";
import { connectTransportFor, dispatcherOf } from "../channels/http/http.connect-host.channel.ts";
import { HttpConnectLicenseChannel } from "../channels/http/http.connect-license.channel.ts";
import {
  buildLicensingCustomerPipeline,
  type LicensingCustomerPipeline,
} from "../eventing/licensing-customer.pipeline.ts";
import type { ActivationCodeRepository } from "../repositories/activation-code.repository.ts";
import type { ConnectOrganizationRepository } from "../repositories/connect-organization.repository.ts";
import type { InstanceIdentityRepository } from "../repositories/instance-identity.repository.ts";
import type { IssuedLicenseRepository } from "../repositories/issued-license.repository.ts";
import type { LicensingRepositories } from "../repositories/licensing.repositories.ts";
import type { MemberSeatRepository } from "../repositories/member-seat.repository.ts";
import type { SelfHostedInstanceRepository } from "../repositories/self-hosted-instance.repository.ts";
import { ACTIVATION_ATTEMPTS_LIMIT } from "../rules/activation-code.rules.ts";
import { LICENSE_SYNCS_LIMIT } from "../rules/issued-license.rules.ts";
import { licenseVerifyingKeyOf } from "../rules/license-verifying-key.rules.ts";
import { ActivationCodeService } from "../services/activation-code.service.ts";
import type { ActivationRateLimit } from "../services/activation-code.service.ts";
import {
  ConfiguredActivationService,
  type ConfiguredActivationOutcome,
} from "../services/configured-activation.service.ts";
import { ConnectCredentialService } from "../services/connect-credential.service.ts";
import { ConnectInstallService } from "../services/connect-install.service.ts";
import type { ConnectUpstreamSlot } from "../services/connect-install.service.ts";
import { ContractBudgetService } from "../services/contract-budget.service.ts";
import type { ContractBudgets } from "../services/contract-budget.service.ts";
import { DomainClaimAuthorityService } from "../services/domain-claim-authority.service.ts";
import { HostedServicesService } from "../services/hosted-services.service.ts";
import { InstanceIdentityService } from "../services/instance-identity.service.ts";
import { LicenseRefreshService } from "../services/license-refresh.service.ts";
import { LicenseRegistryService } from "../services/license-registry.service.ts";
import type { ConnectManagedKeys, LicenseCustomers } from "../services/license-registry.service.ts";
import { LicenseSyncService } from "../services/license-sync.service.ts";
import type { LicenseSyncRateLimit } from "../services/license-sync.service.ts";
import { LicenseService, LicenseServiceConfiguration } from "../services/license.service.ts";
import type { LicenseLogger, LicenseStorage } from "../services/license.service.ts";
import { LicensingCustomerFactsService } from "../services/licensing-customer-facts.service.ts";
import { LicensingEntitlementSourceService } from "../services/licensing-entitlement-source.service.ts";
import { LicensingInfrastructureService } from "../services/licensing-infrastructure.service.ts";
import { SelfHostedCrmService } from "../services/self-hosted-crm.service.ts";
import type { SelfHostedLeadsInfrastructure } from "../services/self-hosted-crm.service.ts";
import { SelfHostedInstanceService } from "../services/self-hosted-instance.service.ts";

/** Seat counts over organization's membership rows, read through its shares (R-C1f, Q9). */
function seatCountsOver(
  organizations: Pick<MemberSeatRepository, "countMemberSeats">,
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
}>;

type LicensingRuntime = Readonly<Omit<LicensingInfrastructure, "repository">>;

const logger = createLogger("langwatch:licensing");

type LicensingSetup = FeatureSetup<
  typeof LicensingModule.dependencies,
  LicensingServerConfig,
  LicensingRepositories
>;

export class LicensingModule implements LicensingApiContract {
  static readonly contract: typeof LicensingApi = LicensingApi;
  static readonly dependencies = {
    /** Where an install's hosted provider slot is kept: a gateway fact licensing writes. */
    gateway: GatewayApi,
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
  readonly #instances: SelfHostedInstanceService;
  readonly #install: ConnectInstallService;
  readonly #identity: InstanceIdentityService;
  readonly #customerFacts: LicensingCustomerFactsService;
  readonly #refresh: LicenseRefreshService;
  readonly #isSaas: boolean;
  readonly #signingKey: string | undefined;
  readonly #domainClaims: DomainClaimAuthorityService;
  #configuredActivation: ConfiguredActivationService | undefined;

  /** The licensing_customer pipeline, whose facts organization applies (R42). */
  customerPipeline(): LicensingCustomerPipeline {
    return buildLicensingCustomerPipeline({
      attachManagedKey: (provisioned) => this.#credentials.attachProvisioned(provisioned),
    });
  }

  /** Binds the licensing_customer pipeline's senders into the facts service. */
  connectCustomerCommands(commands: EventingCommands<LicensingCustomerPipeline>): void {
    this.#customerFacts.connect(commands);
  }

  /** The facts service those senders bind into, for the licence writes of this module's tasks. */
  customerFactsService(): LicensingCustomerFactsService {
    return this.#customerFacts;
  }

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
    customerFacts,
  }: {
    customerFacts: LicensingCustomerFactsService;
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
    this.#instances = registry.instances;
    this.#install = install.install;
    this.#identity = install.identity;
    this.#customerFacts = customerFacts;
    this.#refresh = install.refresh;
  }

  static async create(setup: LicensingSetup): Promise<LicensingModule> {
    const instanceLicenseKey = await setup.secrets.into(
      LicensingModule.secrets.instanceLicenseKey,
      (value) => value,
    );
    const licensePrivateKey = await setup.secrets.into(
      LicensingModule.secrets.licensePrivateKey,
      (value) => value,
    );
    return LicensingModule.#assemble(setup, { instanceLicenseKey, licensePrivateKey });
  }

  static #assemble(
    { config, resources, dependencies, repositories, role }: LicensingSetup,
    {
      instanceLicenseKey,
      licensePrivateKey,
    }: { instanceLicenseKey: string | undefined; licensePrivateKey: string | undefined },
  ): LicensingModule {
    const { publicKey, ignoredVariable, refuseDevStack } = licenseVerifyingKeyOf({
      override: config.publicKey,
      isReleaseBuild,
    });
    if (ignoredVariable) {
      logger.warn(
        { variable: ignoredVariable },
        `${ignoredVariable} is ignored on a release build; licences verify against the embedded LangWatch key`,
      );
    }
    const cryptography = NodeLicenseCryptographyService.create({ publicKey, refuseDevStack });
    // The variable takes a signed key or an activation code. A code is not a
    // license: it is redeemed at start and stored on an organization.
    const configured = detectLicenseInputForm(instanceLicenseKey);
    const signedInstanceKey = configured.form === "license_key" ? configured.licenseKey : undefined;
    const customerFacts = LicensingCustomerFactsService.create();
    // The licence rows are this module's own; the seat counts are organization's
    // own membership classification (a peer, not owned here).
    const { repository, ...runtime } = LicensingInfrastructureService.create({ role }).withStorage({
      licenses: repositories.organizationLicenses,
      facts: customerFacts,
      ...seatCountsOver(repositories.memberSeats),
    });
    const registryParts = licenseRegistryParts({
      infrastructure: licenseRegistryOver({
        repositories,
        customerFacts,
        gateway: dependencies.gateway,
        signingKey: licensePrivateKey,
      }),
      instances: selfHostedInstancesOver({ repositories }),
      cryptography,
      logger,
    });
    const service = LicenseService.create({
      repository,
      cryptography,
      logger,
      configuration: LicenseServiceConfiguration.create(),
      instanceLicenseKey: signedInstanceKey,
    });
    const connectInfrastructure = connectInstallOver({
      repositories,
      gateway: dependencies.gateway,
      config,
      cryptography,
      version: releaseVersionOf(config),
      instanceLicenseKey: signedInstanceKey,
    });
    const app = new LicensingModule({
      customerFacts,
      generation: LicenseGenerationService.create(cryptography),
      service,
      runtime,
      entitlements: LicensingEntitlementSourceService.create({
        licensing: service,
        mode: config.isSaas ? "cloud" : "self-hosted",
      }),
      registry: registryParts,
      install: connectInstallParts({
        infrastructure: connectInfrastructure,
        customerFacts,
        cryptography,
        seats: repository,
        licenses: service,
        config,
        publicKey,
        logger,
      }),
      isSaas: config.isSaas,
      signingKey: licensePrivateKey,
      domainClaims: DomainClaimAuthorityService.create({
        isSaas: config.isSaas,
        licenses: service,
        organizations: repositories.connectOrganizations,
      }),
    });
    if (!config.isSaas && configured.form === "activation_code") {
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
        logger,
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

  getConnectServiceState(input: {
    organizationId: string;
    service: ConnectService;
  }): Promise<ConnectServiceState> {
    return this.#install.getServiceState(input);
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

  findConnectServicesForManagedKey(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<ConnectService[]> {
    return this.#credentials.findEntitledServices(input);
  }

  findManagedKeyLicense(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<{ services: ConnectService[] }[]> {
    return this.#hosted.findManagedKeyLicense(input);
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
}

/** A redemption at start gives up well before the transport's own timeout. */
const BOOT_REDEMPTION_TIMEOUT_MS = 15_000;

/** What the registry and the hosted routes resolve to together. */
type LicenseRegistryParts = Readonly<{
  registry: LicenseRegistryService;
  credentials: ConnectCredentialService;
  sync: LicenseSyncService;
  contractBudgets: ContractBudgetService;
  activation: ActivationCodeService;
  hosted: HostedServicesService;
  instances: SelfHostedInstanceService;
}>;

function licenseRegistryParts({
  infrastructure,
  instances,
  cryptography,
  logger,
}: {
  infrastructure: LicenseRegistryInfrastructure;
  instances: SelfHostedInstancesInfrastructure;
  cryptography: LicenseCryptography;
  logger?: LicenseLogger;
}): LicenseRegistryParts {
  const now = () => nowInstant();
  const contractBudgets = ContractBudgetService.create({
    licensesOf: (organizationId) => infrastructure.repository.findAllByOrganization(organizationId),
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
    contractBudgets: infrastructure.contractBudgets,
    cryptography,
    generation: LicenseGenerationService.create(cryptography),
    signingKey: infrastructure.signingKey,
    now,
  });
  return {
    credentials,
    contractBudgets,
    registry,
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
      now,
    }),
    sync: LicenseSyncService.create({
      credentials,
      repository: infrastructure.repository,
      managedKeys: infrastructure.managedKeys,
      rateLimit: infrastructure.syncRateLimit,
      systemActorId: infrastructure.systemActorId,
      now,
    }),
  };
}

/**
 * The licence registry over this module's own stores, as main's
 * `registry/composition.ts` built it on every deployment. Billing reads the seat
 * changes it records through `findSeatChanges` (ARCHITECTURE.md section 9).
 */
function licenseRegistryOver({
  repositories,
  gateway,
  signingKey,
  customerFacts,
}: {
  repositories: Pick<
    LicensingRepositories,
    "issuedLicenses" | "activationCodes" | "rateLimits" | "connectOrganizations"
  >;
  customerFacts: Pick<
    LicensingCustomerFactsService,
    | "selfHostedCustomerLicensed"
    | "managedKeyRetired"
    | "managedKeyInvalidated"
    | "connectCredentialIssued"
    | "contractTermsChanged"
  >;
  gateway: Pick<
    GatewayApi,
    "setManagedKeyConnectServicesInternal" | "setManagedKeyLicenseInternal"
  >;
  signingKey: string | undefined;
}): LicenseRegistryInfrastructure {
  const systemActorId = SYSTEM_ACTORS.connectLicense;
  const allowed = async (key: string, limit: { requests: number; seconds: number }) =>
    (await repositories.rateLimits.check(key, limit)).allowed;
  return {
    repository: repositories.issuedLicenses,
    organizations: {
      findById: customerLookup(repositories.connectOrganizations),
      recordSelfHostedCustomerLicensed: ({ id, name }) =>
        customerFacts.selfHostedCustomerLicensed({ organizationId: id, name }),
    },
    managedKeys: {
      issue: (issued) => customerFacts.connectCredentialIssued(issued),
      retire: (key) => customerFacts.managedKeyRetired(key),
      invalidate: (key) => customerFacts.managedKeyInvalidated(key),
      setConnectServices: (key) => gateway.setManagedKeyConnectServicesInternal(key),
      setLicense: (key) => gateway.setManagedKeyLicenseInternal(key),
    },
    // Connect syncs the budget from the fact, so licensing writes none (C3a-S2).
    contractBudgets: { sync: (input) => customerFacts.contractTermsChanged(input) },
    activationCodes: repositories.activationCodes,
    activationRateLimit: {
      allow: ({ codeHash }) => allowed(`activation_code:${codeHash}`, ACTIVATION_ATTEMPTS_LIMIT),
    },
    syncRateLimit: {
      allow: ({ licenseRowId }) => allowed(`license_sync:${licenseRowId}`, LICENSE_SYNCS_LIMIT),
    },
    signingKey: () => signingKey,
    systemActorId,
  };
}

/** The customer's id and name, read from organization's table through its share (R40). */
function customerLookup(
  organizations: Pick<ConnectOrganizationRepository, "findCustomer">,
): LicenseCustomers["findById"] {
  return async (organizationId) => {
    const customer = await organizations.findCustomer(organizationId);
    return customer ? { id: customer.id, name: customer.name } : null;
  };
}

/**
 * The instance registry over this module's own stores, as main built it on
 * every deployment: the rows from Postgres, the customer's name from its owner.
 */
function selfHostedInstancesOver({
  repositories,
}: {
  repositories: Pick<
    LicensingRepositories,
    "selfHostedInstances" | "issuedLicenses" | "connectOrganizations"
  >;
}): SelfHostedInstancesInfrastructure {
  return {
    repository: repositories.selfHostedInstances,
    licenses: repositories.issuedLicenses,
    organizations: {
      findById: customerLookup(repositories.connectOrganizations),
    },
    optionalReportKeys: new Set(optionalUsageReportKeys()),
  };
}

/** The three services the install end of Connect resolves to. */
type ConnectInstallParts = Readonly<{
  install: ConnectInstallService;
  identity: InstanceIdentityService;
  refresh: LicenseRefreshService;
}>;

/**
 * The install end over this module's own stores. Every deployment has
 * these two tables; whether anything is called is decided by the license and by
 * `LANGWATCH_CONNECT_DISABLED`, never by whether a client was composed.
 */
function connectInstallOver({
  repositories,
  gateway,
  config,
  cryptography,
  version,
  instanceLicenseKey,
}: {
  repositories: Pick<LicensingRepositories, "connectOrganizations" | "instanceIdentity">;
  gateway: Pick<GatewayApi, "setConnectUpstreamInternal" | "clearConnectUpstreamInternal">;
  config: LicensingServerConfig;
  cryptography: LicenseCryptography;
  version: string;
  instanceLicenseKey: string | undefined;
}): ConnectInstallInfrastructure {
  const permitted = config.connectDisabled !== true;
  const transport = permitted
    ? connectTransportFor({ outboundProxy: parseOutboundProxyConfig(config.outboundProxy) })
    : undefined;
  return {
    organizations: repositories.connectOrganizations,
    identity: repositories.instanceIdentity,
    ...(permitted
      ? {
          gateway: HttpConnectGatewayChannel.create({
            endpoint: config.connectGatewayEndpoint,
            ...(transport ? dispatcherOf(transport) : {}),
          }),
          licenseHost: HttpConnectLicenseChannel.create({
            endpoint: config.connectLicenseEndpoint,
            ...(transport ? dispatcherOf(transport) : {}),
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

function connectInstallParts({
  infrastructure,
  customerFacts,
  cryptography,
  seats,
  licenses,
  config,
  publicKey,
  logger,
}: {
  infrastructure: ConnectInstallInfrastructure;
  customerFacts: LicensingCustomerFactsService;
  cryptography: LicenseCryptography;
  seats: LicenseStorage;
  licenses: LicenseService;
  config: LicensingServerConfig;
  /** The key licences verify against, as the build allows it; undefined is the embedded key. */
  publicKey: string | undefined;
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
    facts: customerFacts,
    identity,
    cryptography,
    deployment: {
      permitted: config.connectDisabled !== true,
      gatewayEndpoint: config.connectGatewayEndpoint,
      licenseEndpoint: config.connectLicenseEndpoint,
    },
    ...(infrastructure.gateway ? { gateway: infrastructure.gateway } : {}),
    instanceLicenseKey: infrastructure.instanceLicenseKey,
    ...(publicKey ? { publicKey } : {}),
    ...(infrastructure.upstream ? { upstream: infrastructure.upstream } : {}),
    ...(logger ? { logger } : {}),
  });
  return {
    identity,
    install,
    refresh: LicenseRefreshService.create({
      instanceId: () => identity.getInstanceId(),
      install,
      facts: customerFacts,
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

/** Everything the license registry needs from the rest of the deployment. */
type LicenseRegistryInfrastructure = Readonly<{
  repository: IssuedLicenseRepository;
  organizations: LicenseCustomers;
  managedKeys: ConnectManagedKeys;
  /** Records that the customer's terms moved; connect syncs the budget from the fact. */
  contractBudgets: ContractBudgets;
  /** The codes a fresh install pastes instead of a license blob (ADR-156 §5). */
  activationCodes: ActivationCodeRepository;
  /** What bounds guessing a code: one limiter, keyed by the code's own hash. */
  activationRateLimit: ActivationRateLimit;
  syncRateLimit: LicenseSyncRateLimit;
  /** The signing key, resolved through the secrets chain. Never a config field. */
  signingKey: () => string | undefined;
  /** Attributed when the registry itself ends a key nothing authenticated with. */
  systemActorId: string;
}>;

/**
 * The install end of Connect (ADR-156, section 9): what a self-hosted
 * deployment needs to call LangWatch with the license it already holds. Absent
 * where the deployment switched Connect off, which builds no client at all.
 */
type ConnectInstallInfrastructure = Readonly<{
  organizations: ConnectOrganizationRepository;
  identity: InstanceIdentityRepository;
  /** Composed only where Connect is permitted; absent means no outbound call. */
  gateway?: ConnectGatewayChannel;
  licenseHost?: ConnectLicenseChannel;
  /** The gateway's hosted provider slot; absent where no gateway is composed beside. */
  upstream?: ConnectUpstreamSlot;
  /** The key this whole deployment is licensed by, where one is set. */
  instanceLicenseKey: () => string | undefined;
  /** A fresh instance identity. Supplied, so a suite mints a predictable one. */
  newInstanceId: () => string;
  /** The release this install runs: `releaseVersionOf` over the shared release leaves. */
  version: () => string;
  /** The identity an operator named instead of the one this install minted. */
  instanceIdOverride?: string;
}>;

/**
 * The registry of self-hosted installs (ADR-156, section 10), which the usage
 * report receiver writes. Every deployment composes it from its own stores.
 */
type SelfHostedInstancesInfrastructure = Readonly<{
  repository: SelfHostedInstanceRepository;
  /** The licence bound to an install, which names its customer. */
  licenses: Pick<IssuedLicenseRepository, "findAllBoundToInstance">;
  /** The customer's name, as the organization feature answers it. */
  organizations: Pick<LicenseCustomers, "findById">;
  /** The usage report's optional-category keys, from its field dictionary. */
  optionalReportKeys: ReadonlySet<string>;
  leads?: SelfHostedLeadsInfrastructure;
}>;
