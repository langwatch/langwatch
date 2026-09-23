import type { ResolvePlanInput } from "@langwatch/entitlement-contract";
import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  ActivationCodePage,
  ActivationCodeView,
  IssueActivationCodeInput,
  IssuedActivationCode,
} from "./activation-code.ts";
import type {
  ConnectedSeats,
  ContractTerms,
  HostedCapAnswer,
  HostedCaller,
  HostedClassifyAnswer,
  HostedUsageAnswer,
} from "./connect-hosted.ts";
import type {
  ActivationAnswer,
  ConnectClassifyAnswer,
  ConnectDeploymentView,
  ConnectStatus,
  InstanceIdentityView,
  LicenseRefreshOutcome,
  LicenseSyncAnswer,
} from "./connect-install.ts";
import type { ConnectService } from "./connect-services.ts";
import type {
  IssuedLicensePage,
  IssuedLicenseSource,
  IssuedLicenseView,
  LicenseCustomer,
  LicenseTermsInput,
  SeatChangeBillingOutcome,
} from "./issued-license.ts";
import type { LimitCheckResult, LimitType } from "./license-limit-type.ts";
import type { PlanInfo } from "./license-plan.ts";
import type {
  ConnectCredentialResolution,
  ConnectPresentedCredential,
  LicenseSyncBody,
} from "./license-sync.ts";
import type { StoreLicenseInput } from "./license.commands.ts";
import type {
  LicenseStatus,
  PlatformLicenseAccess,
  RemoveLicenseResult,
  SsoGateStatus,
  StoreLicenseResult,
} from "./license.ts";
import type {
  IncomingUsageReport,
  SelfHostedInstanceDetail,
  SelfHostedInstancePage,
  SelfHostedSignal,
} from "./self-hosted-instance.ts";

/**
 * The caller, as the enforcement service classifies them: a lite member is
 * counted differently from a full one, and a deployment's operator allow-list
 * is keyed by address, so an id alone cannot answer a limit.
 */
export type LicensingCaller = Readonly<{ id: string; email?: string | null }>;

/** One limit, asked about one organization on behalf of one caller. */
export type LicenseLimitCheck = Readonly<{
  organizationId: string;
  limitType: LimitType;
  user: LicensingCaller;
}>;

/** The portable signed-license capability supplied to process peers. */
export interface LicensingApi {
  resolve(input: ResolvePlanInput): Promise<PlanInfo>;
  /** Every license on this deployment, the instance key first, until one permits the platform. */
  inspectPlatformAccess(): Promise<PlatformLicenseAccess>;
  getActivePlan(organizationId: string): Promise<PlanInfo>;
  getSelfHostedPlan(organizationId: string): Promise<PlanInfo>;
  validateAndStoreLicense(input: {
    organizationId: string;
    licenseKey: string;
  }): Promise<StoreLicenseResult>;
  getLicenseStatus(organizationId: string): Promise<LicenseStatus>;
  removeLicense(organizationId: string): Promise<RemoveLicenseResult>;
  /** Why a deployment configured for single sign-on is not using it. */
  getSsoGateStatus(): Promise<SsoGateStatus>;
  /** Whether a signed license on this deployment permits platform single sign-on. */
  isPlatformSsoLicensed(): Promise<boolean>;
  /** Validates a pasted key and stores it, answering the plan it grants. */
  uploadLicense(input: StoreLicenseInput): Promise<PlanInfo>;
  /**
   * Redeems an activation code with LangWatch and stores the license it
   * minted, through the same validation as a pasted key.
   */
  activateLicenseWithCode(input: { organizationId: string; code: string }): Promise<PlanInfo>;
  /** Whether one limit still admits another resource, for this caller. */
  checkLimit(input: LicenseLimitCheck): Promise<LimitCheckResult>;
  /** Every enforced limit at once, keyed by limit type. */
  checkAllLimits(
    input: Readonly<{ organizationId: string; user: LicensingCaller }>,
  ): Promise<Record<LimitType, LimitCheckResult>>;
  /**
   * A client pre-check refused somebody. The limit is checked again here, so a
   * fabricated report cannot raise an alert nobody can retract.
   */
  reportLimitBlocked(input: LicenseLimitCheck): Promise<void>;

  /**
   * The license registry (ADR-156). Every issue path writes a row here, so a
   * license LangWatch signed never exists without one, and the hosted routes
   * judge a presented token against the row rather than the blob.
   */
  issueLicense(input: IssueLicenseInput): Promise<SignedIssuedLicense>;
  /** Records a license another flow already signed: the purchase, the script. */
  recordIssuedLicense(input: {
    licenseKey: string;
    source: Extract<IssuedLicenseSource, "PURCHASE" | "SCRIPT">;
    organizationId?: string;
  }): Promise<IssuedLicenseView>;
  /** Registers a license signed before the registry existed. */
  registerLegacyLicense(input: {
    licenseKey: string;
    organizationId: string;
    operatorId: string;
  }): Promise<IssuedLicenseView>;
  revokeIssuedLicense(input: {
    id: string;
    operatorId: string;
    reason: string;
  }): Promise<IssuedLicenseView>;
  /** Signs a replacement for a license, held until the install presents it. */
  reissueLicense(input: {
    id: string;
    maxMembers?: number;
    maxMembersLite?: number;
    maxMessagesPerMonth?: number;
    /** ISO 8601. The instant the new term ends. */
    expiresAt: string;
    operatorId: string;
  }): Promise<SignedIssuedLicense>;
  changeLicenseSeats(input: {
    id: string;
    maxMembers: number;
    operatorId: string;
  }): Promise<SeatChangeResult>;
  resetLicenseInstanceBinding(input: { id: string }): Promise<IssuedLicenseView>;
  updateLicenseTerms(
    input: { id: string; operatorId: string } & LicenseTermsInput,
  ): Promise<IssuedLicenseView>;
  linkLicenseToOrganization(input: {
    id: string;
    organizationId: string;
    operatorId: string;
  }): Promise<IssuedLicenseView>;
  getIssuedLicense(input: { id: string }): Promise<IssuedLicenseView>;
  listIssuedLicenses(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<IssuedLicensePage>;

  /** Who a presented `lwl_` bearer is, for a hosted route on LangWatch Cloud. */
  resolveConnectCredential(input: {
    token: string;
    instanceId: string | null | undefined;
  }): Promise<ConnectCredentialResolution>;
  /** One daily sync from a connected install; a refusal throws its credential code. */
  recordLicenseSync(
    input: ConnectPresentedCredential & { body: LicenseSyncBody },
  ): Promise<LicenseSyncAnswer>;

  /**
   * The install end of Connect (ADR-156, section 9). A self-hosted deployment
   * calls LangWatch with the license it already holds; these are what its own
   * screens and workers read and write.
   */
  getConnectStatus(input: { organizationId: string }): Promise<ConnectStatus>;
  /** The hosted services this organization's license names and has left on. */
  findEnabledConnectServices(input: { organizationId: string }): Promise<ConnectService[]>;
  setConnectService(input: {
    organizationId: string;
    service: string;
    enabled: boolean;
  }): Promise<{ enabledServices: ConnectService[] }>;
  /** Moves the customer's own hosted usage cap, up to the contract maximum. */
  setConnectCap(input: {
    organizationId: string;
    capUsd: number;
  }): Promise<{ capUsd: number; maximumCapUsd: number }>;
  /** The identity this install presents to LangWatch, minted on first use. */
  getInstanceId(): Promise<string>;
  /** Whether one hosted service is both entitled here and switched on. */
  isConnectServiceEnabled(input: {
    organizationId: string;
    service: ConnectService;
  }): Promise<boolean>;
  /**
   * Judges one text on LangWatch for an install that holds a license. The
   * install has no judge key of its own, so the judgement happens there and is
   * charged against the budget the license carries.
   */
  classifyThroughConnect(input: {
    organizationId: string;
    text: string;
    questions: readonly unknown[];
  }): Promise<ConnectClassifyAnswer>;
  /** Runs the daily sync by hand and reports what it changed. */
  refreshLicense(input: { organizationId: string }): Promise<LicenseRefreshOutcome>;
  /** The daily pass over every organization whose license names a hosted service. */
  syncLicenses(): Promise<void>;
  /** The install's identity row; empty where it never minted one. Reads, never mints. */
  findInstanceIdentity(): Promise<InstanceIdentityView[]>;
  /** Whether Connect may call out, whether a license names a hosted service, and both hosts. */
  getConnectDeployment(): Promise<ConnectDeploymentView>;
  /** How the last usage report went: no `error` when it landed. */
  recordUsageReportOutcome(input: { error?: string }): Promise<void>;
  /** What a customer switched off in the usage report; an absent switch is left alone. */
  setUsageReportSwitches(input: {
    optionalMetricsOptOut?: boolean;
    hostnameOptOut?: boolean;
  }): Promise<void>;
  /**
   * An administrator read the startup notice for this version of the report.
   * Mints the identity where there is none: the dismissal needs a row.
   */
  acknowledgeStartupNotice(input: { schemaVersion: number }): Promise<void>;

  /**
   * The hosted end of Connect (ADR-156 §5), which only LangWatch Cloud
   * composes: whether the calling key belongs to an entitled license.
   */
  classifyForHostedCaller(input: {
    caller: HostedCaller;
    payload: unknown;
  }): Promise<HostedClassifyAnswer>;
  /** What the caller spent against every budget that applies to it. */
  getHostedUsage(input: { caller: HostedCaller }): Promise<HostedUsageAnswer>;
  /** The customer moves its own hosted cap, up to the contract maximum. */
  setHostedBudgetCap(input: { caller: HostedCaller; payload: unknown }): Promise<HostedCapAnswer>;
  /** What a customer's licenses add up to commercially, right now. */
  getContractTerms(input: { organizationId: string }): Promise<ContractTerms>;
  /** The seats a connected customer holds and last reported, for its statement and overview. */
  getConnectedSeats(input: { organizationId: string }): Promise<ConnectedSeats>;
  /** Raises the prepaid commit a renewal or top-up invoice agreed. */
  raiseContractCommit(input: {
    organizationId: string;
    byUsdCents: number;
    operatorId: string;
  }): Promise<IssuedLicenseView>;
  /** Re-derives the contract budget's cap from the license terms. */
  syncContractBudget(input: { organizationId: string; operatorId: string }): Promise<void>;
  /** Starts a new budget window: spend so far no longer counts. */
  resetContractBudget(input: { organizationId: string; operatorId: string }): Promise<void>;
  /**
   * The hosted services the active license behind one managed key is entitled
   * to, empty when no active license names that key. The gateway resolves a
   * CONNECT key's scope through this and never reads `IssuedLicense` itself.
   */
  findConnectServicesForManagedKey(input: {
    virtualKeyId: string;
    organizationId: string;
  }): Promise<ConnectService[]>;

  /**
   * Activation codes (ADR-156, section 5): the short code a fresh install
   * pastes instead of a license blob. Minting and revoking are the
   * backoffice's; redeeming is a public route an install calls once.
   */
  issueActivationCode(input: IssueActivationCodeInput): Promise<IssuedActivationCode>;
  listActivationCodes(input: {
    page: number;
    pageSize: number;
    organizationId?: string;
  }): Promise<ActivationCodePage>;
  revokeActivationCode(input: { id: string; operatorId: string }): Promise<ActivationCodeView>;
  /** One install presenting one code as its bearer, answered with one license, once. */
  redeemActivationCode(input: ConnectPresentedCredential): Promise<ActivationAnswer>;

  /**
   * The registry of self-hosted installs (ADR-156, section 10). A report
   * presents no credential, so the customer on a row is resolved from the
   * license bound to that instance and never from the report.
   */
  recordUsageReport(input: IncomingUsageReport): Promise<SelfHostedSignal[]>;
  listSelfHostedInstances(input: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<SelfHostedInstancePage>;
  getSelfHostedInstance(input: { id: string }): Promise<SelfHostedInstanceDetail>;
}

/** What an operator supplies when issuing a license from the backoffice. */
export interface IssueLicenseInput {
  customer: LicenseCustomer;
  email: string;
  planType: string;
  maxMembers: number;
  maxMembersLite?: number;
  maxMessagesPerMonth?: number;
  /** ISO 8601. The instant the term ends. */
  expiresAt: string;
  terms?: LicenseTermsInput;
  operatorId: string;
}

/** A signed license and the row that records it. The key is handed over once. */
export interface SignedIssuedLicense {
  licenseKey: string;
  license: IssuedLicenseView;
}

/** A mid-term seat change: the replacement, and what it owed. */
export interface SeatChangeResult extends SignedIssuedLicense {
  previousMaxMembers: number;
  billing: SeatChangeBillingOutcome;
}

/** Re-exported so a peer naming a service does not reach past the api file. */
export type { ConnectService };

export const LicensingApi = moduleApi<LicensingApi>()("licensing");
