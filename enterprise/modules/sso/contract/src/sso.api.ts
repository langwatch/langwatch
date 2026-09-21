import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  SsoConnectionHistoryEntry,
  SsoDomainClaimOutcome,
  SsoDomainProof,
  SsoDomainProved,
  SsoHistoryActivity,
  SsoSetupConnectionInput,
  SsoSetupDomainInput,
} from "./sso-setup.contract.ts";
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
} from "./sso.contract.ts";

/**
 * The operator a back-office read or command is attributed to, as the request
 * boundary knows them. An operator debugging a customer account is still the
 * operator, so the impersonator is who the staff list is checked against.
 */
export type SsoOperator = Readonly<{
  id: string;
  impersonatorId?: string | undefined;
}>;

/**
 * The organization's own administrator. `id` is the session the surface
 * authenticated, which the history names; `impersonatorId` is the operator
 * borrowing that access, who the audit row is filed against.
 */
export type SsoAdministrator = Readonly<{
  id: string;
  impersonatorId?: string | undefined;
}>;

/** Single sign-on: what a deployment may federate with, and the operator's ledger. */
export interface SsoApi {
  /** Whether this deployment's licence permits platform single sign-on. */
  platformAllowed(): Promise<boolean>;
  /** Whether the configured provider has credentials this build can mount. */
  providerIsMounted(): boolean;
  /** The provider a sign-in page should offer, or `"email"`. */
  resolveProvider(): Promise<string>;

  listConnections(
    input: ListSsoConnectionsInput,
    by: SsoOperator,
  ): Promise<BackofficeSsoConnectionPage>;
  /** `undefined` when no connection carries that id. */
  findConnection(
    input: SsoConnectionByIdInput,
    by: SsoOperator,
  ): Promise<BackofficeSsoConnection | undefined>;
  registerConnection(input: RegisterSsoConnectionInput, by: SsoOperator): Promise<void>;
  claimDomain(input: SsoDomainTarget, by: SsoOperator): Promise<void>;
  approveDomainClaim(input: SsoDomainTarget, by: SsoOperator): Promise<void>;
  rejectDomainClaim(input: RejectSsoDomainClaimInput, by: SsoOperator): Promise<void>;
  attestDomain(input: SsoDomainTarget, by: SsoOperator): Promise<void>;
  activateConnection(input: ActivateSsoConnectionInput, by: SsoOperator): Promise<void>;
  suspendConnection(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void>;
  resumeConnection(input: SsoConnectionTarget, by: SsoOperator): Promise<void>;
  requestTeardown(input: SsoConnectionReasonInput, by: SsoOperator): Promise<void>;

  /**
   * What happened to one of the caller's own connections, newest first. The
   * organization is the caller's, so this is the administrator's read rather
   * than the operator's; identity owns the facts and the words.
   */
  findConnectionHistory(input: SsoSetupConnectionInput): Promise<SsoConnectionHistoryEntry[]>;

  /**
   * A tick per change to that same history, for as long as the caller listens.
   * The signal names the connection and nothing else.
   */
  watchConnectionHistory(
    input: SsoSetupConnectionInput & { signal?: AbortSignal },
  ): AsyncGenerator<SsoHistoryActivity>;

  /**
   * The domain ceremony the organization runs itself (ADR-123), where
   * `claimDomain` above is the operator's. Both end at the same aggregate;
   * what differs is who may call and what the history names.
   */
  setupClaimDomain(
    input: SsoSetupDomainInput,
    by: SsoAdministrator,
  ): Promise<SsoDomainClaimOutcome>;
  /** The record to publish, or nothing left to do. Answered once. */
  setupProveDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProof>;
  setupRemoveDomain(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<void>;
  setupCheckDomainRecord(
    input: SsoSetupDomainInput,
    by: SsoAdministrator,
  ): Promise<SsoDomainProved>;
  setupCheckDomainFile(input: SsoSetupDomainInput, by: SsoAdministrator): Promise<SsoDomainProved>;
}

export const SsoApi = moduleApi<SsoApi>()("sso");
