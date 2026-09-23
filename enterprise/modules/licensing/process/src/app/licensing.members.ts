import type { RestIdentity } from "@langwatch/api/rest";
import type {
  ConnectService,
  HostedCaller,
  LicenseData,
  SeatChangeBillingOutcome,
  SignedLicense,
  ValidationResult,
} from "@langwatch/enterprise-licensing-contract";
import type { GatewayConnectUpstream } from "@langwatch/gateway-contract";
import type { InstantEvalJudgement, InstantEvalQuestion } from "@langwatch/instant-eval-contract";
import type { Instant } from "@langwatch/time";

import type { ConnectGatewayChannel } from "../channels/connect-gateway.channel.ts";
import type { ConnectLicenseChannel } from "../channels/connect-license.channel.ts";
import type { ConnectDispatcher } from "../channels/http/http.connect-host.channel.ts";
import type { ActivationCodeRepository } from "../repositories/activation-code.repository.ts";
import type { ConnectOrganizationRepository } from "../repositories/connect-organization.repository.ts";
import type { InstanceIdentityRepository } from "../repositories/instance-identity.repository.ts";
import type { IssuedLicenseRepository } from "../repositories/issued-license.repository.ts";
import type { SelfHostedInstanceRepository } from "../repositories/self-hosted-instance.repository.ts";
import type { SelfHostedSignalEvent } from "../rules/self-hosted-signals.rules.ts";
import type { ActivationRateLimit } from "../services/activation-code.service.ts";

export interface LicenseCryptography {
  parseLicenseKey(licenseKey: string): SignedLicense | null;
  verifySignature(signedLicense: SignedLicense, publicKey?: string): boolean;
  isExpired(expiresAt: string, now?: Instant): boolean;
  validateLicense(input: {
    licenseKey: string;
    publicKey?: string;
    now?: Instant;
  }): ValidationResult;
  signLicense(data: LicenseData, privateKey: string): SignedLicense;
  encodeLicenseKey(signedLicense: SignedLicense): string;
  generateLicenseId(): string;
  /** The identity an install mints for itself: a bare UUID (ADR-156). */
  generateInstanceId(): string;
  /**
   * The credential a connected install presents: `lwl_` plus the SHA-256 of the
   * canonical `{data, signature}`. Refuses text that is not a license.
   */
  getLicenseToken(licenseKey: string): string;
}

/**
 * The managed gateway key a license resolves to, which the gateway owns. Ending
 * or invalidating it is what reaches a gateway that already cached the
 * credential: both write to the change feed every gateway polls.
 */
export interface ConnectManagedKeys {
  provision(params: { organizationId: string; licenseId: string }): Promise<{ id: string }>;
  /** Ends the key for good. Safe to repeat. */
  retire(params: { virtualKeyId: string; organizationId: string; actorId: string }): Promise<void>;
  /** Makes every gateway resolve the license again on its next call. */
  invalidate(params: { virtualKeyId: string; organizationId: string }): Promise<void>;
  /** The platform services the gateway lets this key serve; empty serves none. */
  setConnectServices(params: {
    virtualKeyId: string;
    organizationId: string;
    services: readonly ConnectService[];
  }): Promise<void>;
  /**
   * The license the key serves, as the gateway resolves a token by it: the
   * registry hash, the bound install (none while unbound) and the term's end.
   */
  setLicense(params: {
    virtualKeyId: string;
    organizationId: string;
    tokenHash: string;
    instanceId: string | null;
    expiresAt: Instant;
  }): Promise<void>;
}

/** The customer a license is issued to, as the organization feature answers it. */
export interface LicenseCustomers {
  findById(id: string): Promise<{ id: string; name: string } | null>;
  createSelfHostedCustomer(params: { name: string }): Promise<{ id: string; name: string }>;
  markSelfHostedCustomer(id: string): Promise<void>;
}

/**
 * The customer's contract budget, which follows the commercial terms of its
 * licenses. Called after any change that can move those terms. The module owns
 * the behaviour; composition supplies only the store below.
 */
export interface ContractBudgets {
  sync(params: { organizationId: string; operatorId: string }): Promise<void>;
}

/** The one blocking organization budget hosted usage stops at. */
export interface ContractBudget {
  id: string;
  limitUsdCents: number;
  /** Whether the customer chose this cap, as opposed to it following the commit. */
  capSetByCustomer: boolean;
}

/**
 * Where the contract budget is kept, which is the gateway's own budget table.
 * Declared here and answered by composition: licensing states what it needs of
 * a budget and never queries a table another feature owns.
 */
export interface ContractBudgetStore {
  findForOrganization(organizationId: string): Promise<ContractBudget | null>;
  create(params: {
    organizationId: string;
    limitUsdCents: number;
    operatorId: string;
  }): Promise<void>;
  setLimit(params: {
    organizationId: string;
    id: string;
    limitUsdCents: number;
    capSetByCustomer: boolean;
    actorId: string;
  }): Promise<void>;
  /** Starts a new window: spend so far no longer counts against the cap. */
  reset(params: { organizationId: string; id: string; actorId: string }): Promise<void>;
}

/** One budget that applies to the caller, with its spend when that is known. */
export interface HostedBudgetUsage {
  id: string;
  scope: string;
  window: string;
  limitUsd: number;
  /** Null when live spend could not be read. Never zero in that case. */
  spentUsd: number | null;
  onBreach: "block" | "warn";
  periodStartedAt: Instant;
  isContract: boolean;
}

/** The budgets that apply to the calling key, with live spend when readable. */
export interface HostedUsageReader {
  read(caller: HostedCaller): Promise<{
    budgets: HostedBudgetUsage[];
    spendAvailable: boolean;
    readAt: Instant;
  }>;
}

/**
 * The judge a hosted classify call reaches, and what its answer is worth. Both
 * belong to instant-eval; licensing states only what a hosted call needs.
 */
export interface HostedJudge {
  classify(
    input: { projectId: string; text: string; questions: readonly InstantEvalQuestion[] },
    signal?: AbortSignal,
  ): Promise<InstantEvalJudgement>;
  /** What one judgement cost LangWatch, and what the customer is charged. */
  priceOf(input: { inputTokens: number }): { costUsd: number; priceUsd: number };
}

/** Where metered hosted usage is written. One record covers many calls. */
export interface HostedSpendRecorder {
  recordSpend(entry: {
    projectId: string;
    virtualKeyId: string;
    inputTokens: number;
    requests: number;
    costUsd: number;
    priceUsd: number;
    occurredAt: Instant;
  }): Promise<void>;
}

/**
 * The hosted end of Connect (ADR-156, section 5): only LangWatch Cloud
 * composes one. An install has no hosted routes, and its operations refuse by
 * name rather than answering an empty entitlement.
 */
export type HostedServicesInfrastructure = Readonly<{
  budgets: ContractBudgetStore;
  usage: HostedUsageReader;
  judge: HostedJudge;
  spend: HostedSpendRecorder;
  /**
   * The door the Go data plane's signed calls arrive at. The signing scheme is
   * the gateway's own, so the identity is supplied rather than rebuilt here.
   */
  door?: RestIdentity;
}>;

/**
 * What a mid-term seat change owes. The registry only names the change; billing
 * decides the amount and keeps the invoice from being raised twice.
 */
export interface SeatChangeBilling {
  invoiceAddedSeats(params: {
    organizationId: string;
    /** The reissued registry row the new seat count is signed into. */
    licenseRowId: string;
    previousSeats: number;
    seats: number;
    operatorId: string;
  }): Promise<SeatChangeBillingOutcome>;
}

/** Whether this license may sync again now (48 calls per license per day). */
export interface LicenseSyncRateLimit {
  allow(params: { licenseRowId: string }): Promise<boolean>;
}

/** Holds a reissued license at rest until the install that owns it presents it. */
export interface LicenseDeliveryCipher {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

/** Everything the license registry needs from the rest of the deployment. */
export type LicenseRegistryInfrastructure = Readonly<{
  repository: IssuedLicenseRepository;
  organizations: LicenseCustomers;
  managedKeys: ConnectManagedKeys;
  /** The codes a fresh install pastes instead of a license blob (ADR-156 §5). */
  activationCodes: ActivationCodeRepository;
  /** What bounds guessing a code: one limiter, keyed by the code's own hash. */
  activationRateLimit: ActivationRateLimit;
  seatBilling: SeatChangeBilling;
  syncRateLimit: LicenseSyncRateLimit;
  cipher: LicenseDeliveryCipher;
  /** The signing key, resolved through the secrets chain. Never a config field. */
  signingKey: () => string | undefined;
  /** Attributed when the registry itself ends a key nothing authenticated with. */
  systemActorId: string;
}>;

/**
 * The hosted provider slot the install's own gateway adds for one organization,
 * which the gateway owns. Licensing sets it only while managed models may be
 * reached, and clears it on every other change of license, service or Connect.
 */
export interface ConnectUpstreamSlot {
  set(params: GatewayConnectUpstream): Promise<void>;
  clear(params: { organizationId: string }): Promise<void>;
}

/**
 * The install end of Connect (ADR-156, section 9): what a self-hosted
 * deployment needs to call LangWatch with the license it already holds. Absent
 * where the deployment switched Connect off, which builds no client at all.
 */
export type ConnectInstallInfrastructure = Readonly<{
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
  /** The release this install runs: the process's `serviceVersion` member, drilled in. */
  version: () => string;
  /** The identity an operator named instead of the one this install minted. */
  instanceIdOverride?: string;
}>;

/** The person CRM traits are written through: the same member on every report. */
export interface CloudCustomer {
  userId: string;
  organizationName: string;
}

/** Lookups over LangWatch Cloud's own customers, answered by their owners. */
export interface CloudCustomerLookup {
  /** The organization's longest-standing member first; empty when it has none. */
  findRepresentatives(organizationId: string): Promise<CloudCustomer[]>;
  /** Whether anybody on this email domain has a Cloud account. */
  hasAccountOnDomain(domain: string): Promise<boolean>;
}

/** The install's traits on the customer's CRM object. */
export type SelfHostedOrgTraits = Readonly<Record<string, string | number | boolean>>;

export interface SelfHostedLeadNurturing {
  groupUser(input: { userId: string; groupId: string; traits: SelfHostedOrgTraits }): Promise<void>;
  trackEvent(input: {
    userId: string;
    event: SelfHostedSignalEvent;
    properties: Record<string, unknown>;
  }): Promise<void>;
}

export interface SelfHostedLeadNotifications {
  sendSlackSelfHostedSignal(payload: {
    headline: string;
    instanceId: string;
    organizationName: string | null;
    leadingDomain: string | null;
    version: string | null;
    users: number | null;
    traces28d: number | null;
    instanceUrl: string;
  }): Promise<void>;
}

/** Where a lead signal goes; absent where nothing is listening, which raises none. */
export type SelfHostedLeadsInfrastructure = Readonly<{
  customers: CloudCustomerLookup;
  notifications: SelfHostedLeadNotifications;
  nurturing?: SelfHostedLeadNurturing;
  baseUrl: string;
}>;

/**
 * The registry of self-hosted installs (ADR-156, section 10), which the usage
 * report receiver on LangWatch Cloud writes. Only Cloud composes one.
 */
export type SelfHostedInstancesInfrastructure = Readonly<{
  repository: SelfHostedInstanceRepository;
  /** The usage report's optional-category keys, from its field dictionary. */
  optionalReportKeys: ReadonlySet<string>;
  leads?: SelfHostedLeadsInfrastructure;
}>;

/** The pool outbound calls share; the composition root owns the proxy rules. */
export type ConnectInstallDispatcher = ConnectDispatcher;

export interface LicenseLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export type LicenseRetentionRule = {
  scopeType: string;
  scopeId: string;
  category: string;
};

export interface LicenseRetention {
  listOrganizationRules(organizationId: string): Promise<readonly LicenseRetentionRule[]>;

  setForOrganization(input: {
    organizationId: string;
    category: string;
    retentionDays: number;
  }): Promise<void>;
}

export type LicenseUsageCount = number | "unlimited" | "unknown";

export interface LicenseUsage {
  getCurrentMonthCount(input: { organizationId: string }): Promise<LicenseUsageCount>;
}

/**
 * The one license read by plan resolution: the key an organization activated.
 * Narrower than LicenseStorage to avoid pulling seat-count enforcement into
 * plan-only processes.
 */
export interface OrganizationLicense {
  tryReadLicense(organizationId: string): Promise<string | null>;
}

export type StoredLicense = {
  licenseKey: string;
  expiresAt: Instant;
  validatedAt: Instant;
};

export type OrganizationLicenseCandidate = {
  organizationId: string;
  licenseKey: string;
};

/**
 * The platform-access scan: every organization running on an activated key.
 * An installation with no instance key is licensed by these rows alone.
 */
export interface OrganizationLicenseCandidates {
  findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]>;
}

/** Both licence reads, which is what a repository over the rows answers. */
export interface OrganizationLicenseReads
  extends OrganizationLicense, OrganizationLicenseCandidates {}

/**
 * Persistence and seat-count port. Concrete database adapters stay in
 * apps, except the reads, inherited from `OrganizationLicenseReads` so a
 * plan-resolution-only process can compose those alone, without seats.
 */
export interface LicenseStorage extends OrganizationLicenseReads {
  organizationExists(organizationId: string): Promise<boolean>;
  storeLicense(organizationId: string, license: StoredLicense): Promise<void>;
  removeLicense(organizationId: string): Promise<void>;
  getMemberCount(organizationId: string): Promise<number>;
  getMembersLiteCount(organizationId: string): Promise<number>;
}
