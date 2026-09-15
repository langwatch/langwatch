import { moduleApi } from "@langwatch/runtime-composition";
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
}

export const SsoApi = moduleApi<SsoApi>("sso");
