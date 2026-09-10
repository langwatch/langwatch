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
  SsoApi,
  ssoConfigurationSchema,
  type SsoApi as SsoApiContract,
  type ActivateSsoConnectionInput,
  type BackofficeSsoConnection,
  type BackofficeSsoConnectionPage,
  type ListSsoConnectionsInput,
  type RegisterSsoConnectionInput,
  type RejectSsoDomainClaimInput,
  type SsoConfiguration,
  type SsoConnectionByIdInput,
  type SsoConnectionReasonInput,
  type SsoConnectionTarget,
  type SsoDomainTarget,
  type SsoOperator,
} from "@langwatch/enterprise-sso-contract";
import { AdminSurfaceHiddenError, OpsApi } from "@langwatch/ops-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import { UserApi } from "@langwatch/user-contract";

import { BetterAuthSsoProviderMount } from "../services/better-auth-sso.service.ts";
import type {
  SsoConnectionLedgerOperator,
  SsoConnectionLedger,
} from "./sso.infrastructure.ts";
import type { SsoGateLogger } from "./sso.infrastructure.ts";
import { SsoGateService } from "../services/sso-gate.service.ts";

/** What the process composes this feature's application over. */
export type SsoInfrastructure = Readonly<{
  /** The identity aggregate's connection ledger, as the back office commands it. */
  connections: SsoConnectionLedger;
  /** Where the gate's decisions are written. */
  logger: SsoGateLogger;
}>;

type SsoSetup = FeatureSetup<typeof SsoApp.dependencies, SsoInfrastructure, SsoConfiguration>;

/**
 * How long a removal stays reversible before the process manager completes it.
 * Seven days: long enough that a mistaken teardown is noticed by somebody
 * signing in on a Monday, short enough that a connection nobody wants does not
 * linger routing.
 */
const TEARDOWN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

/** The audit row's target, so a connection's history is one query. */
const AUDIT_TARGET_KIND = "ssoConnection";

export class SsoApp implements SsoApiContract {
  static readonly contract = SsoApi;
  static readonly dependencies = {
    licensing: LicensingApi,
    operators: OpsApi,
    users: UserApi,
    auditLog: AuditLogApi,
  };
  static readonly configSchema = ssoConfigurationSchema;

  readonly #gate: SsoGateService;
  readonly #connections: SsoConnectionLedger;
  readonly #operators: OpsApi;
  readonly #users: UserApi;
  readonly #auditLog: AuditLogApi;

  private constructor(
    gate: SsoGateService,
    connections: SsoConnectionLedger,
    dependencies: SsoSetup["dependencies"],
  ) {
    this.#gate = gate;
    this.#connections = connections;
    this.#operators = dependencies.operators;
    this.#users = dependencies.users;
    this.#auditLog = dependencies.auditLog;
  }

  static create({ dependencies, infrastructure, config }: SsoSetup): SsoApp {
    return new SsoApp(
      SsoGateService.create({
        configuration: config,
        licensing: dependencies.licensing,
        logger: infrastructure.logger,
        providerMountInspector: BetterAuthSsoProviderMount.create(),
      }),
      infrastructure.connections,
      dependencies,
    );
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
    const profile = await this.#users.tryFindById({ id: userId });
    if (!this.#operators.isAdmin({ email: profile?.email })) throw new AdminSurfaceHiddenError();

    return { userId };
  }
}
