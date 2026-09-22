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
  ssoSecrets,
  SsoApi,
  type SsoApi as SsoApiContract,
  type ActivateSsoConnectionInput,
  type BackofficeSsoConnection,
  type BackofficeSsoConnectionPage,
  type ListSsoConnectionsInput,
  type RegisterSsoConnectionInput,
  type RejectSsoDomainClaimInput,
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
  type SsoSetupStartMigrationInput,
} from "@langwatch/enterprise-sso-contract";
import {
  EntitlementApi,
  EnterprisePlanRequiredError,
  isEnterpriseTier,
} from "@langwatch/entitlement-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { AdminSurfaceHiddenError, OpsApi } from "@langwatch/ops-contract";
import { UserApi } from "@langwatch/user-contract";

import {
  buildGenericOAuthConfigs,
  buildSocialProviders,
} from "../rules/better-auth-sso-adapter.rules.ts";
import { ssoServiceProviderAddresses } from "../rules/sso-service-provider.rules.ts";
import { SsoGateService, SsoProviderMountInspector } from "../services/sso-gate.service.ts";
import { SsoHistoryActivityService } from "../services/sso-history-activity.service.ts";
import type {
  SsoActivityLogger,
  SsoConnectionLedgerOperator,
  SsoConnectionHistoryReads,
  SsoConnectionLedger,
  SsoDomainCeremonyLedger,
  SsoGateLogger,
  SsoSelfServeActor,
  SsoSetupCommandLedger,
  SsoSetupReads,
} from "./sso.members.ts";

/** Whether the configured provider can actually be mounted by BetterAuth. */
class BetterAuthSsoProviderMount extends SsoProviderMountInspector {
  static create(): BetterAuthSsoProviderMount {
    return new BetterAuthSsoProviderMount();
  }

  isMounted(configuration: SsoConfiguration): boolean {
    return (
      Object.keys(buildSocialProviders(configuration)).length > 0 ||
      buildGenericOAuthConfigs(configuration).length > 0
    );
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
  const [
    instanceLicenseKey,
    googleClientSecret,
    githubClientSecret,
    gitlabClientSecret,
    azureAdClientSecret,
    auth0ClientSecret,
    oktaClientSecret,
    cognitoClientSecret,
    oneLoginClientSecret,
    oidcClientSecret,
  ] = await Promise.all([
    secrets.into(ssoSecrets.instanceLicenseKey, (value) => value),
    secrets.into(ssoSecrets.googleClientSecret, (value) => value),
    secrets.into(ssoSecrets.githubClientSecret, (value) => value),
    secrets.into(ssoSecrets.gitlabClientSecret, (value) => value),
    secrets.into(ssoSecrets.azureAdClientSecret, (value) => value),
    secrets.into(ssoSecrets.auth0ClientSecret, (value) => value),
    secrets.into(ssoSecrets.oktaClientSecret, (value) => value),
    secrets.into(ssoSecrets.cognitoClientSecret, (value) => value),
    secrets.into(ssoSecrets.oneLoginClientSecret, (value) => value),
    secrets.into(ssoSecrets.oidcClientSecret, (value) => value),
  ]);

  return {
    isSaas: members.isSaas,
    provider: config.provider,
    baseUrl: members.publicBaseUrl ?? "http://localhost",
    instanceLicenseKey,
    googleClientId: config.googleClientId,
    googleClientSecret,
    githubClientId: config.githubClientId,
    githubClientSecret,
    gitlabClientId: config.gitlabClientId,
    gitlabClientSecret,
    azureAdClientId: config.azureAdClientId,
    azureAdClientSecret,
    azureAdTenantId: config.azureAdTenantId,
    auth0ClientId: config.auth0ClientId,
    auth0ClientSecret,
    auth0Issuer: config.auth0Issuer,
    oktaClientId: config.oktaClientId,
    oktaClientSecret,
    oktaIssuer: config.oktaIssuer,
    cognitoClientId: config.cognitoClientId,
    cognitoClientSecret,
    cognitoIssuer: config.cognitoIssuer,
    oneLoginClientId: config.oneLoginClientId,
    oneLoginClientSecret,
    oneLoginIssuer: config.oneLoginIssuer,
    oidcClientId: config.oidcClientId,
    oidcClientSecret,
    oidcIssuer: config.oidcIssuer,
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
  static readonly secrets = ssoSecrets;
  /** `publicBaseUrl` is not one of the closed `reads()` members. */
  static readonly reads = ["logger", "publicBaseUrl", "isSaas"] as const;

  readonly #gate: SsoGateService;
  readonly #connections: SsoConnectionLedger;
  readonly #ceremony: SsoDomainCeremonyLedger;
  readonly #selfServe: SsoSetupCommandLedger;
  readonly #history: SsoConnectionHistoryReads;
  readonly #setup: SsoSetupReads;
  /** The deployment an identity provider is pointed back at. */
  readonly #baseUrl: string;
  readonly #historyActivity: SsoHistoryActivityService;
  readonly #operators: OpsApi;
  readonly #users: UserApi;
  readonly #auditLog: AuditLogApi;
  readonly #entitlements: Pick<EntitlementApi, "getActivePlan">;

  private constructor(
    gate: SsoGateService,
    connections: SsoConnectionLedger,
    ceremony: SsoDomainCeremonyLedger,
    selfServe: SsoSetupCommandLedger,
    history: SsoConnectionHistoryReads,
    setup: SsoSetupReads,
    baseUrl: string,
    logger: SsoActivityLogger,
    dependencies: SsoSetup["dependencies"],
  ) {
    this.#gate = gate;
    this.#connections = connections;
    this.#ceremony = ceremony;
    this.#selfServe = selfServe;
    this.#history = history;
    this.#setup = setup;
    this.#baseUrl = baseUrl;
    this.#historyActivity = SsoHistoryActivityService.create({ history, logger });
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
      rename: (input, actor) => setup().rename({ ...input, actor }),
      setArrivals: (input, actor) => setup().setArrivals({ ...input, actor }),
      discardConnection: (input, actor) => setup().discardConnection({ ...input, actor }),
      removeConnection: (input, actor) => setup().removeConnection({ ...input, actor }),
    };
    const configuration = await resolveConfiguration(config, members, secrets);
    return new SsoApp(
      SsoGateService.create({
        configuration,
        licensing: dependencies.licensing,
        logger: members.logger,
        providerMountInspector: BetterAuthSsoProviderMount.create(),
      }),
      connections,
      domains,
      selfServe,
      { getHistory: (input) => dependencies.identity.ssoConnectionHistory().getHistory(input) },
      {
        getSetup: (input) => dependencies.identity.ssoSetup().getSetup(input),
        getMigrationProgress: (input) =>
          dependencies.identity.ssoSetup().getMigrationProgress(input),
      },
      configuration.baseUrl,
      members.logger,
      dependencies,
    );
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

  async listConnections(
    input: ListSsoConnectionsInput,
    by: SsoOperator,
  ): Promise<BackofficeSsoConnectionPage> {
    return this.#audited(
      by,
      "getAll",
      { page: input.page, pageSize: input.pageSize, hasSearch: Boolean(input.search) },
      () => this.#connections.list(input),
    );
  }

  async findConnection(
    input: SsoConnectionByIdInput,
    by: SsoOperator,
  ): Promise<BackofficeSsoConnection | undefined> {
    return this.#audited(
      by,
      "getById",
      { connectionId: input.connectionId },
      async () => (await this.#connections.findById(input)) ?? undefined,
    );
  }

  async registerConnection(input: RegisterSsoConnectionInput, by: SsoOperator): Promise<void> {
    await this.#audited(by, "register", { ...input }, (operator) =>
      this.#connections.registerConnection({ ...input, operator }),
    );
  }

  async claimDomain(input: SsoDomainTarget, by: SsoOperator): Promise<void> {
    await this.#audited(by, "claimDomain", { ...input }, (operator) =>
      this.#connections.claimDomain({ ...input, operator }),
    );
  }

  async approveDomainClaim(input: SsoDomainTarget, by: SsoOperator): Promise<void> {
    await this.#audited(by, "approveDomainClaim", { ...input }, (operator) =>
      this.#connections.approveDomainClaim({ ...input, operator }),
    );
  }

  async rejectDomainClaim(input: RejectSsoDomainClaimInput, by: SsoOperator): Promise<void> {
    // The note is an operator's prose about a customer and audit rows outlive
    // the decision, so the command carries it and the audit row does not.
    const { note: _note, ...recorded } = input;
    await this.#audited(by, "rejectDomainClaim", recorded, (operator) =>
      this.#connections.rejectDomainClaim({ ...input, operator }),
    );
  }

  async attestDomain(input: SsoDomainTarget, by: SsoOperator): Promise<void> {
    await this.#audited(by, "attestDomain", { ...input }, (operator) =>
      this.#connections.attestDomain({ ...input, operator }),
    );
  }

  async activateConnection(input: ActivateSsoConnectionInput, by: SsoOperator): Promise<void> {
    await this.#audited(by, "activate", { ...input }, (operator) =>
      this.#connections.activateConnection({ ...input, operator }),
    );
  }

  async suspendConnection(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void> {
    await this.#audited(by, "suspend", { ...input }, (operator) =>
      this.#connections.suspendConnection({ ...input, operator }),
    );
  }

  async resumeConnection(input: SsoConnectionTarget, by: SsoOperator): Promise<void> {
    await this.#audited(by, "resume", { ...input }, (operator) =>
      this.#connections.resumeConnection({ ...input, operator }),
    );
  }

  async requestTeardown(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void> {
    await this.#audited(by, "requestTeardown", { ...input }, (operator) =>
      this.#connections.requestTeardown({ ...input, operator, graceMs: TEARDOWN_GRACE_MS }),
    );
  }

  setupClaimDomain(
    input: SsoSetupDomainInput,
    by: SsoAdministrator,
  ): Promise<SsoDomainClaimOutcome> {
    return this.#attempted(by, "claimDomain", input, (actor) =>
      this.#ceremony.claimDomain(input, actor),
    );
  }

  setupProveDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProof> {
    return this.#attempted(by, "proveDomain", input, (actor) =>
      this.#ceremony.proveDomain(input, actor),
    );
  }

  setupRemoveDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<void> {
    return this.#attempted(by, "removeDomain", input, (actor) =>
      this.#ceremony.removeDomain(input, actor),
    );
  }

  setupCheckDomainRecord(
    input: SsoSetupDomainInput,
    by: SsoAdministrator,
  ): Promise<SsoDomainProved> {
    return this.#attempted(by, "checkDomainRecord", input, (actor) =>
      this.#ceremony.checkDomainRecord(input, actor),
    );
  }

  setupCheckDomainFile(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProved> {
    return this.#attempted(by, "checkDomainFile", input, (actor) =>
      this.#ceremony.checkDomainFile(input, actor),
    );
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

    return this.#attempted(
      by,
      "register",
      {
        organizationId: input.organizationId,
        providerId: input.providerId,
        protocol: input.idp.protocol,
      },
      (actor) =>
        this.#selfServe.register(
          {
            organizationId: input.organizationId,
            providerId: input.providerId,
            registration: input.idp,
          },
          actor,
        ),
    );
  }

  /** Registering a replacement is registering, so it is gated like one. */
  async setupStartLegacyMigration(
    input: SsoSetupStartMigrationInput,
    by: SsoAdministrator,
  ): Promise<SsoSetupRegistered> {
    await this.#requireEnterprisePlan(input.organizationId);

    return this.#attempted(
      by,
      "startLegacyMigration",
      {
        organizationId: input.organizationId,
        connectionId: input.legacyConnectionId,
        providerId: input.providerId,
        protocol: input.idp.protocol,
      },
      (actor) =>
        this.#selfServe.startLegacyMigration(
          {
            organizationId: input.organizationId,
            legacyConnectionId: input.legacyConnectionId,
            providerId: input.providerId,
            registration: input.idp,
          },
          actor,
        ),
    );
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

    await this.#attempted(by, "selectMigrationRoute", { ...input }, (actor) =>
      this.#selfServe.selectMigrationRoute(input, actor),
    );
  }

  /**
   * Ungated: a rename decides nothing about who signs in, and an organization
   * whose plan lapsed still reads these cards. The name is audited in full —
   * it is the word the card shows, and who changed it is what the history
   * beside it is for.
   */
  async setupRename(input: SsoSetupRenameInput, by: SsoAdministrator): Promise<void> {
    await this.#attempted(by, "rename", { ...input }, (actor) =>
      this.#selfServe.rename(input, actor),
    );
  }

  /**
   * Which answer an organization is on is the whole fact somebody asking why a
   * stranger turned up in the member list needs, so the row carries it.
   */
  async setupSetArrivals(input: SsoSetupArrivalsInput, by: SsoAdministrator): Promise<void> {
    await this.#requireEnterprisePlan(input.organizationId);

    await this.#attempted(by, "setArrivals", { ...input }, (actor) =>
      this.#selfServe.setArrivals(
        {
          organizationId: input.organizationId,
          connectionId: input.connectionId,
          arrivalPolicy: input.policy,
        },
        actor,
      ),
    );
  }

  /** Ungated, like the removal below it: a lapsed plan must never be the
   *  reason an organization cannot take its own connection back out. */
  async setupDiscardConnection(
    input: SsoSetupConnectionInput,
    by: SsoAdministrator,
  ): Promise<void> {
    await this.#attempted(by, "discardConnection", { ...input }, (actor) =>
      this.#selfServe.discardConnection(input, actor),
    );
  }

  async setupRemoveConnection(input: SsoSetupRemovalInput, by: SsoAdministrator): Promise<void> {
    await this.#attempted(by, "removeConnection", { ...input }, (actor) =>
      this.#selfServe.removeConnection({ ...input, graceMs: TEARDOWN_GRACE_MS }, actor),
    );
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
  async #attempted<T>(
    by: SsoAdministrator,
    action: string,
    args: Record<string, string | null> & { organizationId: string },
    ceremony: (actor: SsoSelfServeActor) => Promise<T>,
  ): Promise<T> {
    await this.#auditLog.record({
      userId: by.impersonatorId ?? by.id,
      organizationId: args.organizationId,
      action: `ssoSetup.${action}`,
      args: { ...args },
      targetKind: AUDIT_TARGET_KIND,
      ...(args.connectionId === undefined || args.connectionId === null
        ? {}
        : { targetId: args.connectionId }),
    });

    return ceremony({ userId: by.id });
  }

  /**
   * Gate, run, then record. The row says the ledger answered, so a refusal at
   * the gate and a command the ledger threw on both leave nothing behind.
   */
  async #audited<T>(
    by: SsoOperator,
    action: string,
    args: Record<string, unknown>,
    command: (operator: SsoConnectionLedgerOperator) => Promise<T>,
  ): Promise<T> {
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
