// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The technical shape this feature asks the process for: the identity
 * aggregate's connection ledger, as the back office commands it, and where
 * the gate's decisions are written.
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


export interface SsoConnectionLedgerPort {
  list(input: ListSsoConnectionsInput): Promise<BackofficeSsoConnectionPage>;
  /** `null` when no connection carries that id; absence is a normal answer here. */
  findById(input: SsoConnectionByIdInput): Promise<BackofficeSsoConnection | null>;
  registerConnection(input: Commanded<RegisterSsoConnectionInput>): Promise<unknown>;
  claimDomain(input: Commanded<SsoDomainTarget>): Promise<void>;
  approveDomainClaim(input: Commanded<SsoDomainTarget>): Promise<void>;
  rejectDomainClaim(input: Commanded<RejectSsoDomainClaimInput>): Promise<void>;
  attestDomain(input: Commanded<SsoDomainTarget>): Promise<void>;
  activateConnection(input: Commanded<ActivateSsoConnectionInput>): Promise<void>;
  suspendConnection(input: Commanded<SsoConnectionReasonInput>): Promise<void>;
  resumeConnection(input: Commanded<SsoConnectionTarget>): Promise<void>;
  requestTeardown(input: SsoConnectionTeardownRequest): Promise<void>;
}

/**
 * Where the gate says what it decided. An operator whose single sign-on is off
 * reads these lines to learn why, so the process supplies its own logger.
 */
export interface SsoGateLogger {
  info(context: object, message: string): void;
  warn(context: object, message: string): void;
}
