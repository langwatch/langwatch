// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The connection ledger the back office reads and commands.
 *
 * The identity aggregate owns it: every change is a guarded command with the
 * operator recorded on it, appended to that tenant's history. This feature
 * states the shape it needs and the process supplies it.
 */
import type {
  ActivateSsoConnectionInput,
  BackofficeSsoConnection,
  BackofficeSsoConnectionPage,
  ListSsoConnectionsInput,
  RegisterSsoConnectionInput,
  RejectSsoDomainClaimInput,
  SsoConnectionByIdInput,
  SsoConnectionReasonInput,
  SsoConnectionTarget,
  SsoDomainTarget,
} from "@langwatch/enterprise-sso-contract";

/** The operator a command is appended under. The ledger mints nothing itself. */
export type SsoConnectionLedgerOperator = Readonly<{ userId: string }>;

type Commanded<Input> = Input & Readonly<{ operator: SsoConnectionLedgerOperator }>;

/** How long a removal stays reversible before the process manager completes it. */
export type SsoConnectionTeardownRequest = Commanded<SsoConnectionReasonInput> &
  Readonly<{ graceMs: number }>;

export abstract class SsoConnectionLedgerPort {
  abstract list(input: ListSsoConnectionsInput): Promise<BackofficeSsoConnectionPage>;
  /** `null` when no connection carries that id; absence is a normal answer here. */
  abstract findById(input: SsoConnectionByIdInput): Promise<BackofficeSsoConnection | null>;
  abstract registerConnection(input: Commanded<RegisterSsoConnectionInput>): Promise<unknown>;
  abstract claimDomain(input: Commanded<SsoDomainTarget>): Promise<void>;
  abstract approveDomainClaim(input: Commanded<SsoDomainTarget>): Promise<void>;
  abstract rejectDomainClaim(input: Commanded<RejectSsoDomainClaimInput>): Promise<void>;
  abstract attestDomain(input: Commanded<SsoDomainTarget>): Promise<void>;
  abstract activateConnection(input: Commanded<ActivateSsoConnectionInput>): Promise<void>;
  abstract suspendConnection(input: Commanded<SsoConnectionReasonInput>): Promise<void>;
  abstract resumeConnection(input: Commanded<SsoConnectionTarget>): Promise<void>;
  abstract requestTeardown(input: SsoConnectionTeardownRequest): Promise<void>;
}
