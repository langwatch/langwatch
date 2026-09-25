// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Single sign-on, as both of its callers reach it: the licence gate a sign-in
 * page asks which provider to offer, and the operator's connection ledger.
 *
 * Every read and every command on the ledger is gated on the ADMIN_EMAILS
 * staff list — deliberately not `ops:*`, because who may attest a customer's
 * domain must not widen with a broader operator population — and recorded
 * AFTER the ledger answers, so the row says what happened rather than what was
 * attempted: a refusal and a failure both leave no row behind.
 */
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  ssoConfig,
  SsoApi,
  type SsoApi as SsoApiContract,
  type SignInProviderMounts,
  type ActivateSsoConnectionInput,
  type BackofficeSsoConnection,
  type BackofficeSsoConnectionPage,
  type ListSsoConnectionsInput,
  type RegisterSsoConnectionInput,
  type AttestSsoDomainInput,
  type RejectSsoDomainClaimInput,
  type SsoBreakGlassBinding,
  type SsoBreakGlassBindingInput,
  type SsoBreakGlassCandidate,
  type SsoBreakGlassGrant,
  type SsoBreakGlassGrantInput,
  type SsoBreakGlassRenewal,
  type SsoBreakGlassRenewalInput,
  type SsoConfig,
  type SsoConfiguration,
  type SsoConnectionByIdInput,
  type SsoConnectionHistoryEntry,
  type SsoConnectionReasonInput,
  type SsoAdministrator,
  type SsoConnectionTarget,
  type SsoDomainClaimOutcome,
  type SsoDomainProof,
  type SsoDomainProved,
  type SsoDomainTarget,
  type SsoHistoryActivity,
  type SsoOperator,
  type SsoSetupArrivalsInput,
  type SsoSetupConnectionInput,
  type SsoSetupDomainInput,
  type SsoSetupMigration,
  type SsoSetupMigrationProgressInput,
  type SsoSetupMigrationRouteInput,
  type SsoSetupOrganizationInput,
  type SsoSetupPageView,
  type SsoSetupRegistered,
  type SsoSetupRegisterInput,
  type SsoSetupRemovalInput,
  type SsoSetupRenameInput,
  type SsoSelfServeContext,
  type SsoSetupStartMigrationInput,
} from "@langwatch/enterprise-sso-contract";
import {
  configuredAuthProvider,
  isNamedProviderMounted,
  resolveSignInProviders,
} from "@langwatch/enterprise-sso-contract/sign-in-providers";
import {
  EntitlementApi,
  EnterprisePlanRequiredError,
  isEnterpriseTier,
} from "@langwatch/entitlement-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { AdminSurfaceHiddenError, OpsApi } from "@langwatch/ops-contract";
import { signInProviderSecrets } from "@langwatch/secrets";
import { UserApi } from "@langwatch/user-contract";

import {
  buildGenericOAuthConfigs,
  buildSocialProviders,
} from "../rules/sign-in-providers.rules.ts";
import { ssoServiceProviderAddresses } from "../rules/sso-service-provider.rules.ts";
import { SsoGateService, SsoProviderMountInspector } from "../services/sso-gate.service.ts";
import { SsoHistoryActivityService } from "../services/sso-history-activity.service.ts";
import {
  InstanceLicenseProof,
  LicenseDomainClaimAuthority,
  SsoSelfServeContextService,
} from "../services/sso-self-serve-context.service.ts";
import type {
  SsoActivityLogger,
  SsoBreakGlassLedger,
  SsoConnectionLedgerOperator,
  SsoConnectionHistoryReads,
  SsoConnectionLedger,
  SsoDomainCeremonyLedger,
  SsoGateLogger,
  SsoSelfServeActor,
  SsoSetupCommandLedger,
  SsoSetupReads,
} from "./sso.members.ts";

/** Whether the NAMED provider mounts on Better Auth (main's `authProviderIsMounted`). */
class BetterAuthSsoProviderMount extends SsoProviderMountInspector {
  static create(): BetterAuthSsoProviderMount {
    return new BetterAuthSsoProviderMount();
  }

  isMounted(configuration: SsoConfiguration): boolean {
    return isNamedProviderMounted(configuration);
  }
}

/**
 * Shapes restated rather than imported from `@langwatch/process-stores`: a
 * module depends on contracts. `publicBaseUrl` is the process's own fact,
 * drilled in — absent where the deployment named no `BASE_HOST`.
 * `isSaas` is the process's own fact too: `IS_SAAS` has one owner, the process
 * slice, and every module that needs it reads it here.
 */
export type SsoInfrastructure = Readonly<{
  /** Where the gate's decisions are written. */
  logger: SsoGateLogger;
  publicBaseUrl: string | undefined;
  isSaas: boolean;
}>;

type SsoSetup = FeatureSetup<typeof SsoApp.dependencies, SsoInfrastructure, SsoConfig>;

/** Every credential this module resolves, alongside the deployment facts. */
async function resolveConfiguration(
  config: SsoConfig,
  members: SsoInfrastructure,
  secrets: SsoSetup["secrets"],
): Promise<SsoConfiguration> {
  const { deprecatedNameUsed } = configuredAuthProvider(config);
  if (deprecatedNameUsed) {
    members.logger.warn(
      { module: "sso" },
      "NEXTAUTH_PROVIDER is deprecated - set AUTH_PROVIDER instead. The configured value still applies.",
    );
  }

  return {
    ...(await resolveSignInProviders({
      config,
      into: secrets.into,
      baseUrl: members.publicBaseUrl ?? "http://localhost",
    })),
    isSaas: members.isSaas,
  };
}

/**
 * How long a removal stays reversible before the process manager completes it.
 * Seven days: long enough that a mistaken teardown is noticed by somebody
 * signing in on a Monday, short enough that a connection nobody wants does not
 * linger routing.
 */
const TEARDOWN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The audit row's target, so a connection's history is one query. */
const AUDIT_TARGET_KIND = "ssoConnection";

/**
 * What an organization whose plan does not carry single sign-on is told. The
 * words are upstream's, carried as a literal because entitlement's feature
 * registry has no `SSO` key yet (handoff §10).
 */
const SSO_ENTERPRISE_REFUSAL = "Single sign-on requires an Enterprise plan";

export class SsoApp implements SsoApiContract {
  static readonly contract = SsoApi;
  static readonly dependencies = {
    licensing: LicensingApi,
    operators: OpsApi,
    users: UserApi,
    auditLog: AuditLogApi,
    identity: IdentityApi,
    entitlements: EntitlementApi,
  };
  static readonly config = ssoConfig;
  static readonly secrets = signInProviderSecrets;
  /** `publicBaseUrl` is not one of the closed `reads()` members. */
  static readonly reads = ["logger", "publicBaseUrl", "isSaas"] as const;

  readonly #gate: SsoGateService;
  readonly #connections: SsoConnectionLedger;
  readonly #ceremony: SsoDomainCeremonyLedger;
  readonly #selfServe: SsoSetupCommandLedger;
  readonly #breakGlass: SsoBreakGlassLedger;
  readonly #history: SsoConnectionHistoryReads;
  readonly #setup: SsoSetupReads;
  /** The deployment an identity provider is pointed back at. */
  readonly #baseUrl: string;
  /** The providers this deployment configured, with their resolved credentials. */
  readonly #configuration: SsoConfiguration;
  readonly #historyActivity: SsoHistoryActivityService;
  readonly #selfServeContext: SsoSelfServeContextService;
  readonly #operators: OpsApi;
  readonly #users: UserApi;
  readonly #auditLog: AuditLogApi;
  readonly #entitlements: Pick<EntitlementApi, "getActivePlan">;

  private constructor({
    gate,
    connections,
    ceremony,
    selfServe,
    breakGlass,
    history,
    setup,
    configuration,
    logger,
    dependencies,
  }: {
    gate: SsoGateService;
    connections: SsoConnectionLedger;
    ceremony: SsoDomainCeremonyLedger;
    selfServe: SsoSetupCommandLedger;
    breakGlass: SsoBreakGlassLedger;
    history: SsoConnectionHistoryReads;
    setup: SsoSetupReads;
    configuration: SsoConfiguration;
    logger: SsoActivityLogger;
    dependencies: SsoSetup["dependencies"];
  }) {
    this.#gate = gate;
    this.#connections = connections;
    this.#ceremony = ceremony;
    this.#selfServe = selfServe;
    this.#breakGlass = breakGlass;
    this.#history = history;
    this.#setup = setup;
    this.#baseUrl = configuration.baseUrl;
    this.#configuration = configuration;
    this.#historyActivity = SsoHistoryActivityService.create({ history, logger });
    const isHosted = () => configuration.isSaas;
    this.#selfServeContext = SsoSelfServeContextService.create({
      authority: LicenseDomainClaimAuthority.create({
        isHosted,
        licensedAtStartup: () => gate.platformAllowed(),
      }),
      licenseProof: InstanceLicenseProof.create({ licensing: dependencies.licensing }),
      // Hosted self-serve (tier 3) is not offered: nothing stages the claim
      // queue it waits on. When it ships this reads the organization's
      // `self_serve_sso` opt-in - handoff §10.
      optIn: { isOptedIn: async () => false },
      isHosted,
    });
    this.#operators = dependencies.operators;
    this.#users = dependencies.users;
    this.#auditLog = dependencies.auditLog;
    this.#entitlements = dependencies.entitlements;
  }

  static async create({ dependencies, members, config, secrets }: SsoSetup): Promise<SsoApp> {
    // A peer may not be invoked while the process constructs, so the ledger
    // forwards to identity per call rather than being fetched here.
    const backoffice = () => dependencies.identity.ssoBackoffice();
    const connections: SsoConnectionLedger = {
      list: (input) => backoffice().list(input),
      findById: (input) => backoffice().findById(input),
      registerConnection: (input) => backoffice().registerConnection(input),
      claimDomain: (input) => backoffice().claimDomain(input),
      approveDomainClaim: (input) => backoffice().approveDomainClaim(input),
      rejectDomainClaim: (input) => backoffice().rejectDomainClaim(input),
      attestDomain: (input) => backoffice().attestDomain(input),
      activateConnection: (input) => backoffice().activateConnection(input),
      suspendConnection: (input) => backoffice().suspendConnection(input),
      resumeConnection: (input) => backoffice().resumeConnection(input),
      requestTeardown: (input) => backoffice().requestTeardown(input),
    };
    const ceremony = () => dependencies.identity.ssoDomainCeremony();
    const domains: SsoDomainCeremonyLedger = {
      claimDomain: (input, actor) => ceremony().claimDomain({ ...input, actor }),
      proveDomain: (input, actor) => ceremony().proveDomain({ ...input, actor }),
      removeDomain: (input, actor) => ceremony().removeDomain({ ...input, actor }),
      checkDomainRecord: (input, actor) => ceremony().checkDomainRecord({ ...input, actor }),
      checkDomainFile: (input, actor) => ceremony().checkDomainFile({ ...input, actor }),
    };
    const setup = () => dependencies.identity.ssoSetupCommands();
    const selfServe: SsoSetupCommandLedger = {
      register: (input, actor) => setup().register({ ...input, actor }),
      startLegacyMigration: (input, actor) => setup().startLegacyMigration({ ...input, actor }),
      selectMigrationRoute: (input, actor) => setup().selectMigrationRoute({ ...input, actor }),
      finalizeLegacyMigration: (input, actor) =>
        setup().finalizeLegacyMigration({ ...input, actor }),
      rename: (input, actor) => setup().rename({ ...input, actor }),
      setArrivals: (input, actor) => setup().setArrivals({ ...input, actor }),
      activate: (input, actor) => setup().activate({ ...input, actor }),
      discardConnection: (input, actor) => setup().discardConnection({ ...input, actor }),
      removeConnection: (input, actor) => setup().removeConnection({ ...input, actor }),
    };
    const ways = () => dependencies.identity.ssoBreakGlass();
    const breakGlass: SsoBreakGlassLedger = {
      findGrants: (input) => ways().findGrants(input),
      findCandidates: (input) => ways().findCandidates(input),
      grant: (input, actor) => ways().grant({ ...input, actor }),
      renew: (input, actor) => ways().renew({ ...input, actor }),
      revoke: (input) => ways().revoke(input),
    };
    const configuration = await resolveConfiguration(config, members, secrets);
    return new SsoApp({
      gate: SsoGateService.create({
        configuration,
        licensing: dependencies.licensing,
        logger: members.logger,
        providerMountInspector: BetterAuthSsoProviderMount.create(),
      }),
      connections,
      ceremony: domains,
      selfServe,
      breakGlass,
      history: {
        getHistory: (input) => dependencies.identity.ssoConnectionHistory().getHistory(input),
      },
      setup: {
        getSetup: (input) => dependencies.identity.ssoSetup().getSetup(input),
        getMigrationProgress: (input) =>
          dependencies.identity.ssoSetup().getMigrationProgress(input),
      },
      configuration,
      logger: members.logger,
      dependencies,
    });
  }

  /**
   * Where this organization's setup stands. Identity folds the journey; the
   * addresses an identity provider is pointed at are this module's, because
   * this module is what answers them.
   */
  async getSetup(input: SsoSetupOrganizationInput): Promise<SsoSetupPageView> {
    const journey = await this.#setup.getSetup(input);

    return {
      ...journey,
      serviceProvider: ssoServiceProviderAddresses({
        baseUrl: this.#baseUrl,
        connectionId: journey.connection?.connectionId ?? null,
      }),
    };
  }

  /** Which tier this organization's own setup runs under (D05). */
  getSelfServeContext(input: SsoSetupOrganizationInput): Promise<SsoSelfServeContext> {
    return this.#selfServeContext.resolve(input);
  }

  /** One cutover's members, paged. The setup read carries the first page. */
  getMigrationProgress(
    input: SsoSetupMigrationProgressInput,
  ): Promise<{ migration: SsoSetupMigration | null }> {
    return this.#setup.getMigrationProgress(input);
  }

  async findConnectionHistory(
    input: SsoSetupConnectionInput,
  ): Promise<SsoConnectionHistoryEntry[]> {
    const entries = await this.#history.getHistory(input);

    return entries.map((entry) => ({
      eventId: entry.eventId,
      occurredAtMs: entry.occurredAtMs,
      summary: entry.summary,
      carriedOver: entry.carriedOver,
    }));
  }

  watchConnectionHistory(
    input: SsoSetupConnectionInput & { signal?: AbortSignal },
  ): AsyncGenerator<SsoHistoryActivity> {
    return this.#historyActivity.ticks(input);
  }

  platformAllowed(): Promise<boolean> {
    return this.#gate.platformAllowed();
  }

  providerIsMounted(): boolean {
    return this.#gate.providerIsMounted();
  }

  resolveProvider(): Promise<string> {
    return this.#gate.resolveProvider();
  }

  getSignInProviderMounts(input: { baseUrl: string }): Promise<SignInProviderMounts> {
    return Promise.resolve({
      socialProviders: buildSocialProviders(this.#configuration),
      genericOAuthConfigs:
        buildGenericOAuthConfigs({ ...this.#configuration, baseUrl: input.baseUrl }) ?? [],
    });
  }

  async listConnections(
    input: ListSsoConnectionsInput,
    by: SsoOperator,
  ): Promise<BackofficeSsoConnectionPage> {
    return this.#audited({
      by,
      action: "getAll",
      args: { page: input.page, pageSize: input.pageSize, hasSearch: Boolean(input.search) },
      command: () => this.#connections.list(input),
    });
  }

  async findConnection(
    input: SsoConnectionByIdInput,
    by: SsoOperator,
  ): Promise<BackofficeSsoConnection | undefined> {
    return this.#audited({
      by,
      action: "getById",
      args: { connectionId: input.connectionId },
      command: async () => (await this.#connections.findById(input)) ?? undefined,
    });
  }

  async registerConnection(input: RegisterSsoConnectionInput, by: SsoOperator): Promise<void> {
    await this.#audited({
      by,
      action: "register",
      args: { ...input },
      command: (operator) => this.#connections.registerConnection({ ...input, operator }),
    });
  }

  async claimDomain(input: SsoDomainTarget, by: SsoOperator): Promise<void> {
    await this.#audited({
      by,
      action: "claimDomain",
      args: { ...input },
      command: (operator) => this.#connections.claimDomain({ ...input, operator }),
    });
  }

  async approveDomainClaim(input: SsoDomainTarget, by: SsoOperator): Promise<void> {
    await this.#audited({
      by,
      action: "approveDomainClaim",
      args: { ...input },
      command: (operator) => this.#connections.approveDomainClaim({ ...input, operator }),
    });
  }

  async rejectDomainClaim(input: RejectSsoDomainClaimInput, by: SsoOperator): Promise<void> {
    // The note is an operator's prose about a customer and audit rows outlive
    // the decision, so the command carries it and the audit row does not.
    const { note: _note, ...recorded } = input;
    await this.#audited({
      by,
      action: "rejectDomainClaim",
      args: recorded,
      command: (operator) => this.#connections.rejectDomainClaim({ ...input, operator }),
    });
  }

  async attestDomain(input: AttestSsoDomainInput, by: SsoOperator): Promise<void> {
    const { note: _note, ...recorded } = input;
    await this.#audited({
      by,
      action: "attestDomain",
      args: recorded,
      command: (operator) => this.#connections.attestDomain({ ...input, operator }),
    });
  }

  async activateConnection(input: ActivateSsoConnectionInput, by: SsoOperator): Promise<void> {
    await this.#audited({
      by,
      action: "activate",
      args: { ...input },
      command: (operator) => this.#connections.activateConnection({ ...input, operator }),
    });
  }

  async suspendConnection(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void> {
    await this.#audited({
      by,
      action: "suspend",
      args: { ...input },
      command: (operator) => this.#connections.suspendConnection({ ...input, operator }),
    });
  }

  async resumeConnection(input: SsoConnectionTarget, by: SsoOperator): Promise<void> {
    await this.#audited({
      by,
      action: "resume",
      args: { ...input },
      command: (operator) => this.#connections.resumeConnection({ ...input, operator }),
    });
  }

  async requestTeardown(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void> {
    await this.#audited({
      by,
      action: "requestTeardown",
      args: { ...input },
      command: (operator) =>
        this.#connections.requestTeardown({ ...input, operator, graceMs: TEARDOWN_GRACE_MS }),
    });
  }

  setupClaimDomain(
    input: SsoSetupDomainInput,
    by: SsoAdministrator,
  ): Promise<SsoDomainClaimOutcome> {
    return this.#attempted({
      by,
      action: "claimDomain",
      args: input,
      ceremony: (actor) => this.#ceremony.claimDomain(input, actor),
    });
  }

  setupProveDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProof> {
    return this.#attempted({
      by,
      action: "proveDomain",
      args: input,
      ceremony: (actor) => this.#ceremony.proveDomain(input, actor),
    });
  }

  setupRemoveDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<void> {
    return this.#attempted({
      by,
      action: "removeDomain",
      args: input,
      ceremony: (actor) => this.#ceremony.removeDomain(input, actor),
    });
  }

  setupCheckDomainRecord(
    input: SsoSetupDomainInput,
    by: SsoAdministrator,
  ): Promise<SsoDomainProved> {
    return this.#attempted({
      by,
      action: "checkDomainRecord",
      args: input,
      ceremony: (actor) => this.#ceremony.checkDomainRecord(input, actor),
    });
  }

  setupCheckDomainFile(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProved> {
    return this.#attempted({
      by,
      action: "checkDomainFile",
      args: input,
      ceremony: (actor) => this.#ceremony.checkDomainFile(input, actor),
    });
  }

  /**
   * Registering is the purchase, so it is the press the plan gate stands in
   * front of. The audit row records who asked for what and NOT this input: it
   * carries a client secret, so the recorded args name the protocol instead.
   */
  async setupRegister(
    input: SsoSetupRegisterInput,
    by: SsoAdministrator,
  ): Promise<SsoSetupRegistered> {
    await this.#requireEnterprisePlan(input.organizationId);

    return this.#attempted({
      by,
      action: "register",
      args: {
        organizationId: input.organizationId,
        providerId: input.providerId,
        protocol: input.idp.protocol,
      },
      ceremony: (actor) =>
        this.#selfServe.register(
          {
            organizationId: input.organizationId,
            providerId: input.providerId,
            registration: input.idp,
          },
          actor,
        ),
    });
  }

  /** Registering a replacement is registering, so it is gated like one. */
  async setupStartLegacyMigration(
    input: SsoSetupStartMigrationInput,
    by: SsoAdministrator,
  ): Promise<SsoSetupRegistered> {
    await this.#requireEnterprisePlan(input.organizationId);

    return this.#attempted({
      by,
      action: "startLegacyMigration",
      args: {
        organizationId: input.organizationId,
        connectionId: input.legacyConnectionId,
        providerId: input.providerId,
        protocol: input.idp.protocol,
      },
      ceremony: (actor) =>
        this.#selfServe.startLegacyMigration(
          {
            organizationId: input.organizationId,
            legacyConnectionId: input.legacyConnectionId,
            providerId: input.providerId,
            registration: input.idp,
          },
          actor,
        ),
    });
  }

  /**
   * One recovery lever with two directions. Moving ordinary traffic to the
   * replacement is part of the paid rollout; moving it back to the
   * grandfathered provider is always reachable, a lapsed plan included.
   */
  async setupSelectMigrationRoute(
    input: SsoSetupMigrationRouteInput,
    by: SsoAdministrator,
  ): Promise<void> {
    if (input.route === "direct") await this.#requireEnterprisePlan(input.organizationId);

    await this.#attempted({
      by,
      action: "selectMigrationRoute",
      args: { ...input },
      ceremony: (actor) => this.#selfServe.selectMigrationRoute(input, actor),
    });
  }

  /**
   * Finishing the cutover is part of the rollout that was bought, so it is
   * gated like the registration that started it. What finalizing takes with
   * it — and whether the evidence still allows it — is identity's, re-read
   * there at the moment of the press.
   */
  async setupFinalizeLegacyMigration(
    input: SsoSetupConnectionInput,
    by: SsoAdministrator,
  ): Promise<void> {
    await this.#requireEnterprisePlan(input.organizationId);

    await this.#attempted({
      by,
      action: "finalizeLegacyMigration",
      args: { ...input },
      ceremony: (actor) => this.#selfServe.finalizeLegacyMigration(input, actor),
    });
  }

  /**
   * Ungated: a rename decides nothing about who signs in, and an organization
   * whose plan lapsed still reads these cards. The name is audited in full —
   * it is the word the card shows, and who changed it is what the history
   * beside it is for.
   */
  async setupRename(input: SsoSetupRenameInput, by: SsoAdministrator): Promise<void> {
    await this.#attempted({
      by,
      action: "rename",
      args: { ...input },
      ceremony: (actor) => this.#selfServe.rename(input, actor),
    });
  }

  /**
   * Which answer an organization is on is the whole fact somebody asking why a
   * stranger turned up in the member list needs, so the row carries it.
   */
  async setupSetArrivals(input: SsoSetupArrivalsInput, by: SsoAdministrator): Promise<void> {
    await this.#requireEnterprisePlan(input.organizationId);

    await this.#attempted({
      by,
      action: "setArrivals",
      args: { ...input },
      ceremony: (actor) =>
        this.#selfServe.setArrivals(
          {
            organizationId: input.organizationId,
            connectionId: input.connectionId,
            arrivalPolicy: input.policy,
          },
          actor,
        ),
    });
  }

  /**
   * Turning it on is the same purchase registering was, so it is gated the
   * same way. The preconditions are the aggregate's and are refused one at a
   * time, so the page can name the one step still outstanding.
   */
  async setupActivate(input: SsoSetupConnectionInput, by: SsoAdministrator): Promise<void> {
    await this.#requireEnterprisePlan(input.organizationId);

    await this.#attempted({
      by,
      action: "activate",
      args: { ...input },
      ceremony: (actor) => this.#selfServe.activate(input, actor),
    });
  }

  /** Ungated, like the removal below it: a lapsed plan must never be the
   *  reason an organization cannot take its own connection back out. */
  async setupDiscardConnection(
    input: SsoSetupConnectionInput,
    by: SsoAdministrator,
  ): Promise<void> {
    await this.#attempted({
      by,
      action: "discardConnection",
      args: { ...input },
      ceremony: (actor) => this.#selfServe.discardConnection(input, actor),
    });
  }

  async setupRemoveConnection(input: SsoSetupRemovalInput, by: SsoAdministrator): Promise<void> {
    await this.#attempted({
      by,
      action: "removeConnection",
      args: { ...input },
      ceremony: (actor) =>
        this.#selfServe.removeConnection({ ...input, graceMs: TEARDOWN_GRACE_MS }, actor),
    });
  }

  /**
   * The ways back in this organization holds. A read, and never plan-gated:
   * the whole point of the grant is the morning the identity provider is
   * broken, which is no moment to discover the plan lapsed too.
   */
  findBreakGlassGrants(input: SsoSetupOrganizationInput): Promise<SsoBreakGlassGrant[]> {
    return this.#breakGlass.findGrants(input);
  }

  /** Who one can be granted to: the organization's administrators. */
  findBreakGlassCandidates(input: SsoSetupOrganizationInput): Promise<SsoBreakGlassCandidate[]> {
    return this.#breakGlass.findCandidates(input);
  }

  /**
   * Grant one, with the date it ends. The grantor is the session this surface
   * authenticated, so a way back in is never self-served, and the attempt is
   * recorded before the grant is made.
   */
  setupGrantBreakGlass(
    input: SsoBreakGlassGrantInput,
    by: SsoAdministrator,
  ): Promise<SsoBreakGlassBinding> {
    return this.#attempted({
      by,
      action: "grantBreakGlass",
      args: { ...input },
      ceremony: (actor) => this.#breakGlass.grant(input, actor),
    });
  }

  setupRenewBreakGlass(
    input: SsoBreakGlassRenewalInput,
    by: SsoAdministrator,
  ): Promise<SsoBreakGlassRenewal> {
    return this.#attempted({
      by,
      action: "renewBreakGlass",
      args: { ...input },
      ceremony: (actor) => this.#breakGlass.renew(input, actor),
    });
  }

  /** Ending one is identity's refusal to make while it is the last way in. */
  setupRevokeBreakGlass(
    input: SsoBreakGlassBindingInput,
    by: SsoAdministrator,
  ): Promise<SsoBreakGlassBinding> {
    return this.#attempted({
      by,
      action: "revokeBreakGlass",
      args: { ...input },
      ceremony: () => this.#breakGlass.revoke(input),
    });
  }

  /**
   * Changing an organization's single sign-on takes an Enterprise plan (D09).
   * READS are deliberately never gated: a page that refuses to render cannot
   * say what it is refusing.
   */
  async #requireEnterprisePlan(organizationId: string): Promise<void> {
    const plan = await this.#entitlements.getActivePlan({ organizationId });
    if (!isEnterpriseTier(plan.type)) throw new EnterprisePlanRequiredError(SSO_ENTERPRISE_REFUSAL);
  }

  /**
   * Record the attempt, then run it: somebody asking why a domain changed at
   * 03:14 needs the try, not only the ones that worked. The fact names the
   * session the surface authenticated; the row names the operator borrowing
   * that access where there is one.
   */
  async #attempted<T>({
    by,
    action,
    args,
    ceremony,
  }: {
    by: SsoAdministrator;
    action: string;
    args: Record<string, string | number | null> & { organizationId: string };
    ceremony: (actor: SsoSelfServeActor) => Promise<T>;
  }): Promise<T> {
    await this.#auditLog.record({
      userId: by.impersonatorId ?? by.id,
      organizationId: args.organizationId,
      action: `ssoSetup.${action}`,
      args: { ...args },
      targetKind: AUDIT_TARGET_KIND,
      ...(typeof args.connectionId === "string" ? { targetId: args.connectionId } : {}),
    });

    return ceremony({ userId: by.id });
  }

  /**
   * Gate, run, then record. The row says the ledger answered, so a refusal at
   * the gate and a command the ledger threw on both leave nothing behind.
   */
  async #audited<T>({
    by,
    action,
    args,
    command,
  }: {
    by: SsoOperator;
    action: string;
    args: Record<string, unknown>;
    command: (operator: SsoConnectionLedgerOperator) => Promise<T>;
  }): Promise<T> {
    const operator = await this.#requireOperator(by);
    const answer = await command(operator);
    const connectionId = typeof args.connectionId === "string" ? args.connectionId : undefined;
    const organizationId =
      typeof args.organizationId === "string" ? args.organizationId : undefined;

    await this.#auditLog.record({
      userId: operator.userId,
      action: `ssoConnections.${action}`,
      args: {
        ...args,
        targetKind: AUDIT_TARGET_KIND,
        ...(connectionId === undefined ? {} : { targetId: connectionId }),
      },
      ...(organizationId === undefined ? {} : { organizationId }),
    });

    return answer;
  }

  /**
   * The operator, or a 404 that says nothing about why: the surface does not
   * confirm its own existence to whoever is probing it. An operator debugging
   * a customer account is still the operator, so the impersonator is who the
   * staff list is checked against.
   */
  async #requireOperator(by: SsoOperator): Promise<SsoConnectionLedgerOperator> {
    const userId = by.impersonatorId ?? by.id;
    const profile = await this.#users.findById({ id: userId });
    if (!this.#operators.isAdmin({ email: profile?.email })) throw new AdminSurfaceHiddenError();

    return { userId };
  }
}
