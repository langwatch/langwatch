import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import type {
  OrganizationJoinSetting,
  OrganizationBillingProfile,
  OrganizationWithAdministrators,
  OrganizationIntent,
  OrganizationSettings,
  PersonalFeatures,
  PersonalWorkspace,
  PersonalWorkspaceInput,
  OrganizationIdPage,
  OrganizationIdPageInput,
  OrganizationUsageCount,
  PricingModel,
  SignInSecurityPolicy,
  OrganizationCurrency,
} from "@langwatch/organization-contract";
import type { Project } from "@langwatch/project-contract";
import type { Instant } from "@langwatch/time";

export type PersonalWorkspaceResourceIds = {
  teamId: string;
  teamSlug: string;
  projectSlug: string;
  ownerBindingId: string;
};

/** The personal workspace, or its personal team while project has not created its project. */
export type EnsuredPersonalTeam =
  | { kind: "ready"; workspace: PersonalWorkspace }
  | { kind: "pending"; team: PersonalWorkspace["team"] };

/** What a team read shows of one project, read through the `Project` share. */
export type OrganizationTeamProject = Pick<
  Project,
  "id" | "name" | "slug" | "teamId" | "createdAt" | "updatedAt"
>;

export type PersonalWorkspaceFeatureProject = {
  id: string;
  isPersonal: boolean;
  ownerUserId: string | null;
  organizationId: string | null;
  personalFeatures: unknown;
};

/**
 * The stored settings row, before decryption: `tryFindSettings` is the
 * service's, over this raw read, since encryption is an members
 * concern the repository does not hold.
 */
export type StoredOrganizationSettings = {
  id: string;
  name: string;
  slug: string;
  supportContact: string | null;
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  primaryIntent: OrganizationIntent | null;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3Bucket: string | null;
  createdAt: OrganizationSettings["createdAt"];
  updatedAt: OrganizationSettings["updatedAt"];
};

/** The deployment's cipher: the live repositories seal and open stored S3 settings with it. */
export abstract class OrganizationSettingsCipher {
  abstract encrypt(value: string): string;
  abstract decrypt(value: string): string;
}

/**
 * Persistence owned by the Organization module: the organization's settings
 * row and the personal workspace it hosts. It never crosses into a caller.
 */
export abstract class OrganizationRepository {
  /** Organization ids ordered by id, after the cursor; no limit reads them all. */
  abstract listAllIds(input?: OrganizationIdPageInput): Promise<OrganizationIdPage>;
  /** The usage report's counts; the caller never passes an empty organization list. */
  abstract countUsage(input: {
    organizationIds: readonly string[];
  }): Promise<OrganizationUsageCount>;
  /** The settings row with its S3 endpoint and access key opened. */
  abstract findStoredSettings(organizationId: string): Promise<StoredOrganizationSettings | null>;
  /** Whether a storage secret is held; the ciphertext itself never leaves the repository. */
  abstract hasStoredS3Secret(organizationId: string): Promise<boolean>;
  /** Seals `s3Endpoint`, `s3AccessKeyId` and `s3SecretAccessKey` as it stores them; blank: none. */
  abstract updateSettings(input: {
    organizationId: string;
    name?: string;
    supportContact?: string | null;
    presenceEnabled?: boolean;
    traceSharingEnabled?: boolean;
    primaryIntent?: OrganizationIntent | null;
    s3Endpoint?: string | null;
    s3AccessKeyId?: string | null;
    s3SecretAccessKey?: string | null;
    s3Bucket?: string | null;
  }): Promise<void>;
  /**
   * The guided-onboarding record out of the organization's `signupData`, and back into it. The
   * merge is the repository's because the column holds every other sign-up answer beside this one,
   * and a read-modify-write split across two calls would drop whichever landed second.
   */
  abstract getGuidedOnboarding(input: { organizationId: string }): Promise<GuidedOnboardingRecord>;
  abstract saveGuidedOnboarding(input: {
    organizationId: string;
    record: GuidedOnboardingRecord;
  }): Promise<GuidedOnboardingRecord>;
  /** Returns the oldest team or throws OrganizationHasNoTeamError. */
  /** How colleagues on a matching domain get in; throws for an unknown organization. */
  abstract getJoinSetting(input: { organizationId: string }): Promise<OrganizationJoinSetting>;
  abstract saveJoinSetting(input: {
    organizationId: string;
    setting: OrganizationJoinSetting;
  }): Promise<void>;
  /** The organization claiming this SSO domain, or null. */
  abstract findBySsoDomain(input: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null>;
  /** Main's `?? 0`: an unknown organization reads as unbounded. */
  abstract getSessionPolicy(input: {
    organizationId: string;
  }): Promise<{ maxSessionDurationDays: number }>;
  abstract saveSessionPolicy(input: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<void>;
  /** The four sign-in security columns (GAC-09, GAC-10); throws OrganizationNotFoundError. */
  abstract getSignInSecurityPolicy(input: {
    organizationId: string;
  }): Promise<SignInSecurityPolicy>;
  abstract updateSignInSecurityPolicy(input: {
    organizationId: string;
    policy: SignInSecurityPolicy;
  }): Promise<void>;
  /**
   * Through Organization filtered by an enabled membership, never
   * OrganizationUser keyed by userId alone (ADR-021).
   */
  abstract findSignInSecurityPoliciesForUser(input: {
    userId: string;
  }): Promise<SignInSecurityPolicy[]>;
  /** Every organization that set any rule. */
  abstract findConfiguredSignInSecurityPolicies(): Promise<SignInSecurityPolicy[]>;
  /** An unknown organization has no pricing model and the schema's default currency (EUR). */
  abstract getPricing(input: {
    organizationId: string;
  }): Promise<{ pricingModel: PricingModel | null; currency: "USD" | "EUR" }>;
  /** Null when no per-file dataset limit is set, and for an unknown organization. */
  abstract getDatasetLimits(input: {
    organizationId: string;
  }): Promise<{ attachmentMaxBytes: number | null }>;
  /** An unknown organization reads as not opted in. */
  abstract isInstantEvalsOptedIn(input: { organizationId: string }): Promise<boolean>;
  /** First write wins: the moment and member that gave the agreement are kept. */
  abstract recordInstantEvalsOptIn(input: {
    organizationId: string;
    userId: string;
    at: Instant;
  }): Promise<void>;
  abstract getOldestTeamId(organizationId: string): Promise<string>;
  abstract getBillingProfile(organizationId: string): Promise<OrganizationBillingProfile>;
  abstract getWithAdministrators(organizationId: string): Promise<OrganizationWithAdministrators>;
  abstract updateSentPlanLimitAlert(input: {
    organizationId: string;
    sentAt: Instant;
  }): Promise<void>;
  /** Billing's checkout currency, from its fact (R42); throws OrganizationNotFoundError. */
  abstract updateCurrency(input: {
    organizationId: string;
    currency: OrganizationCurrency;
  }): Promise<void>;
  /** Billing's pricing model, from its fact (R42); throws OrganizationNotFoundError. */
  abstract updatePricingModel(input: {
    organizationId: string;
    pricingModel: PricingModel;
  }): Promise<void>;
  /** The hosted services switched off on licensing's facts; none for an unknown organisation. */
  abstract findConnectServicesDisabled(organizationId: string): Promise<string[]>;
  /** Throws OrganizationNotFoundError. */
  abstract updateConnectServicesDisabled(input: {
    organizationId: string;
    servicesDisabled: readonly string[];
  }): Promise<void>;
  /** A failure keeps the last success's moment; throws OrganizationNotFoundError. */
  abstract updateConnectSyncOutcome(input: {
    organizationId: string;
    at: Instant;
    error: string | null;
  }): Promise<void>;
  /** Throws OrganizationNotFoundError. */
  abstract setLicense(input: {
    organizationId: string;
    licenseKey: string;
    expiresAt: Instant;
    validatedAt: Instant | null;
  }): Promise<void>;
  /** Clears the licence and both its dates; throws OrganizationNotFoundError. */
  abstract clearLicense(input: { organizationId: string }): Promise<void>;
  /** The longest-seated enabled administrator's email, or null when none is. */
  abstract findFirstAdministratorEmail(organizationId: string): Promise<string | null>;
  /** The user's personal team in the organization; throws `TeamNotFoundError`. */
  abstract getPersonalWorkspace(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalWorkspace>;
  abstract ensurePersonalWorkspace(input: {
    workspace: PersonalWorkspaceInput;
    resources: PersonalWorkspaceResourceIds;
  }): Promise<EnsuredPersonalTeam>;
  abstract getPersonalWorkspaceFeatureProject(
    projectId: string,
  ): Promise<PersonalWorkspaceFeatureProject>;
  /** Every project id under the organization's teams, archived included. */
  abstract findProjectIds(organizationId: string): Promise<string[]>;
  /** The id and name of each named project that exists; an unknown id is left out. */
  abstract findProjectNames(projectIds: readonly string[]): Promise<Pick<Project, "id" | "name">[]>;
  /** The organization's live projects, governance excluded, newest first; one team's when named. */
  abstract findProjects(input: {
    organizationId: string;
    teamId?: string;
    limit?: number;
  }): Promise<OrganizationTeamProject[]>;
  /** Audits the owner's feature switch; project stores the switches on organization's fact. */
  abstract appendPersonalWorkspaceFeaturesAudit(input: {
    projectId: string;
    callerUserId: string;
    organizationId: string | null;
    action: string;
    before: PersonalFeatures;
    after: PersonalFeatures;
  }): Promise<void>;
}
