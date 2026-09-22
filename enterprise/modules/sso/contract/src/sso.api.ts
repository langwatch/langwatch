import { moduleApi } from "@langwatch/kernel/module-api";

import type { SsoSelfServeContext } from "./sso-self-serve.contract.ts";
import type {
  SsoBreakGlassBinding,
  SsoBreakGlassBindingInput,
  SsoBreakGlassCandidate,
  SsoBreakGlassGrant,
  SsoBreakGlassGrantInput,
  SsoBreakGlassRenewal,
  SsoBreakGlassRenewalInput,
  SsoConnectionHistoryEntry,
  SsoDomainClaimOutcome,
  SsoDomainProof,
  SsoDomainProved,
  SsoHistoryActivity,
  SsoSetupArrivalsInput,
  SsoSetupConnectionInput,
  SsoSetupDomainInput,
  SsoSetupMigration,
  SsoSetupMigrationProgressInput,
  SsoSetupMigrationRouteInput,
  SsoSetupOrganizationInput,
  SsoSetupPageView,
  SsoSetupRegistered,
  SsoSetupRegisterInput,
  SsoSetupRemovalInput,
  SsoSetupRenameInput,
  SsoSetupStartMigrationInput,
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

  /** Where this organization's setup stands, with the addresses this module
   *  serves folded in beside identity's own reading of the journey. */
  getSetup(input: SsoSetupOrganizationInput): Promise<SsoSetupPageView>;

  /**
   * Which tier this organization's own setup runs under (D05): the
   * deployment, what its licence authorizes, and whether it was opted in.
   */
  getSelfServeContext(input: SsoSetupOrganizationInput): Promise<SsoSelfServeContext>;

  /**
   * One cutover's members, paged. The migration is null where the organization
   * is running none — identity's own shape, kept whole, because "no cutover"
   * is an answer rather than an absence the caller has to handle.
   */
  getMigrationProgress(
    input: SsoSetupMigrationProgressInput,
  ): Promise<{ migration: SsoSetupMigration | null }>;

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

  /**
   * The rest of the journey: registering the provider, saying who it admits,
   * and the two ways a connection leaves. The removals are NOT plan-gated — a
   * lapsed plan must strand nobody.
   */
  setupRegister(input: SsoSetupRegisterInput, by: SsoAdministrator): Promise<SsoSetupRegistered>;
  /** The replacement for a grandfathered connection, and the two levers of
   *  the cutover that follows. */
  setupStartLegacyMigration(
    input: SsoSetupStartMigrationInput,
    by: SsoAdministrator,
  ): Promise<SsoSetupRegistered>;
  setupSelectMigrationRoute(
    input: SsoSetupMigrationRouteInput,
    by: SsoAdministrator,
  ): Promise<void>;
  /** The end of the cutover, on the replacement: what it takes with it is
   *  identity's to decide, and it re-reads the evidence itself. */
  setupFinalizeLegacyMigration(input: SsoSetupConnectionInput, by: SsoAdministrator): Promise<void>;
  /** The word on the card, which routes nothing and is never plan-gated. */
  setupRename(input: SsoSetupRenameInput, by: SsoAdministrator): Promise<void>;
  setupSetArrivals(input: SsoSetupArrivalsInput, by: SsoAdministrator): Promise<void>;
  /** Turn the connection on, on the strength of what it has already recorded:
   *  the test sign-in's account is resolved where the facts are, never
   *  supplied here. Plan-gated, because going live is the purchase. */
  setupActivate(input: SsoSetupConnectionInput, by: SsoAdministrator): Promise<void>;
  setupDiscardConnection(input: SsoSetupConnectionInput, by: SsoAdministrator): Promise<void>;
  setupRemoveConnection(input: SsoSetupRemovalInput, by: SsoAdministrator): Promise<void>;

  /**
   * The way back in (D05): who can still sign in when the identity provider
   * cannot. NONE of these is plan-gated — a lapsed subscription must never be
   * the reason an organization cannot reach its own recovery path.
   */
  findBreakGlassGrants(input: SsoSetupOrganizationInput): Promise<SsoBreakGlassGrant[]>;
  /** The organization's administrators, as the picker names them. */
  findBreakGlassCandidates(input: SsoSetupOrganizationInput): Promise<SsoBreakGlassCandidate[]>;
  /** Never self-served: the grantor is the administrator this surface
   *  authenticated, never an argument. */
  setupGrantBreakGlass(
    input: SsoBreakGlassGrantInput,
    by: SsoAdministrator,
  ): Promise<SsoBreakGlassBinding>;
  setupRenewBreakGlass(
    input: SsoBreakGlassRenewalInput,
    by: SsoAdministrator,
  ): Promise<SsoBreakGlassRenewal>;
  setupRevokeBreakGlass(
    input: SsoBreakGlassBindingInput,
    by: SsoAdministrator,
  ): Promise<SsoBreakGlassBinding>;
}

export const SsoApi = moduleApi<SsoApi>()("sso");
