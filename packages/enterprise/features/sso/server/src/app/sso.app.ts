// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Single sign-on, as both of its callers reach it: the licence gate a sign-in
 * page asks which provider to offer, and the operator's connection ledger.
 *
 * Every read and every command on the ledger is gated on the ADMIN_EMAILS
 * staff list — deliberately not `ops:*`, because who may attest a customer's
 * domain must not widen with a broader operator population — and recorded
 * BEFORE the command runs, so "why did this happen at 03:14" is answerable
 * from the attempts and not only the successes.
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

import { BetterAuthSsoProviderMount } from "../adapters/better-auth.better-auth.adapter.ts";
import type {
  SsoConnectionLedgerOperator,
  SsoConnectionLedgerPort,
} from "../ports/sso-connection-ledger.port.ts";
import type { SsoGateLoggerPort } from "../ports/sso-gate-logger.port.ts";
import { SsoGateService } from "../services/sso-gate.service.ts";

/** What the process composes this feature's application over. */
export type SsoInfrastructure = Readonly<{
  /** The identity aggregate's connection ledger, as the back office commands it. */
  connections: SsoConnectionLedgerPort;
  /** Where the gate's decisions are written. */
  logger: SsoGateLoggerPort;
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
  readonly #connections: SsoConnectionLedgerPort;
  readonly #operators: OpsApi;
  readonly #users: UserApi;
  readonly #auditLog: AuditLogApi;

  private constructor(
    gate: SsoGateService,
    connections: SsoConnectionLedgerPort,
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
    await this.#audited(by, "getAll", {
      page: input.page,
      pageSize: input.pageSize,
      hasSearch: Boolean(input.search),
    });

    return this.#connections.list(input);
  }

  async findConnection(
    input: SsoConnectionByIdInput,
    by: SsoOperator,
  ): Promise<BackofficeSsoConnection | undefined> {
    await this.#audited(by, "getById", { connectionId: input.connectionId });

    return (await this.#connections.findById(input)) ?? undefined;
  }

  async registerConnection(input: RegisterSsoConnectionInput, by: SsoOperator): Promise<void> {
    const operator = await this.#audited(by, "register", { ...input });
    await this.#connections.registerConnection({ ...input, operator });
  }

  async claimDomain(input: SsoDomainTarget, by: SsoOperator): Promise<void> {
    const operator = await this.#audited(by, "claimDomain", { ...input });
    await this.#connections.claimDomain({ ...input, operator });
  }

  async approveDomainClaim(input: SsoDomainTarget, by: SsoOperator): Promise<void> {
    const operator = await this.#audited(by, "approveDomainClaim", { ...input });
    await this.#connections.approveDomainClaim({ ...input, operator });
  }

  async rejectDomainClaim(input: RejectSsoDomainClaimInput, by: SsoOperator): Promise<void> {
    // The note is an operator's prose about a customer and audit rows outlive
    // the decision, so the command carries it and the audit row does not.
    const { note: _note, ...recorded } = input;
    const operator = await this.#audited(by, "rejectDomainClaim", recorded);
    await this.#connections.rejectDomainClaim({ ...input, operator });
  }

  async attestDomain(input: SsoDomainTarget, by: SsoOperator): Promise<void> {
    const operator = await this.#audited(by, "attestDomain", { ...input });
    await this.#connections.attestDomain({ ...input, operator });
  }

  async activateConnection(input: ActivateSsoConnectionInput, by: SsoOperator): Promise<void> {
    const operator = await this.#audited(by, "activate", { ...input });
    await this.#connections.activateConnection({ ...input, operator });
  }

  async suspendConnection(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void> {
    const operator = await this.#audited(by, "suspend", { ...input });
    await this.#connections.suspendConnection({ ...input, operator });
  }

  async resumeConnection(input: SsoConnectionTarget, by: SsoOperator): Promise<void> {
    const operator = await this.#audited(by, "resume", { ...input });
    await this.#connections.resumeConnection({ ...input, operator });
  }

  async requestTeardown(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void> {
    const operator = await this.#audited(by, "requestTeardown", { ...input });
    await this.#connections.requestTeardown({ ...input, operator, graceMs: TEARDOWN_GRACE_MS });
  }

  /** Gate and record in one move; the row is written before the ledger is asked. */
  async #audited(
    by: SsoOperator,
    action: string,
    args: Record<string, unknown>,
  ): Promise<SsoConnectionLedgerOperator> {
    const operator = await this.#requireOperator(by);
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

    return operator;
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
