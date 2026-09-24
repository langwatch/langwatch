import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import type {
  JoinRequestJoining,
  OrganizationBillingProfile,
  OrganizationIntent,
  OrganizationSettings,
  PersonalFeatures,
  PersonalWorkspace,
  PersonalWorkspaceInput,
  OrganizationUsageCount,
} from "@langwatch/organization-contract";

export type PersonalWorkspaceResourceIds = {
  teamId: string;
  teamSlug: string;
  projectId: string;
  projectSlug: string;
  projectApiKey: string;
  ownerBindingId: string;
};

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

/**
 * Persistence owned by the Organization module: the organization's settings
 * row and the personal workspace it hosts. It never crosses into a caller.
 */
export abstract class OrganizationRepository {
  /** Every organization on the install; the usage report describes the install, not a tenant. */
  abstract findAllIds(): Promise<string[]>;
  /** The usage report's counts; the caller never passes an empty organization list. */
  abstract countUsage(input: {
    organizationIds: readonly string[];
  }): Promise<OrganizationUsageCount>;
  abstract findStoredSettings(organizationId: string): Promise<StoredOrganizationSettings | null>;
  /**
   * Persists already-encrypted `s3Endpoint`/`s3AccessKeyId`/`s3SecretAccessKey`
   * values: encryption is the caller's decision, made with the settings
   * cipher before this is called.
   */
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
  abstract getJoinSetting(input: { organizationId: string }): Promise<JoinRequestJoining>;
  abstract saveJoinSetting(input: {
    organizationId: string;
    setting: JoinRequestJoining;
  }): Promise<void>;
  abstract getOldestTeamId(organizationId: string): Promise<string>;
  abstract getBillingProfile(organizationId: string): Promise<OrganizationBillingProfile>;
  abstract claimBillingCustomerId(input: {
    organizationId: string;
    billingCustomerId: string;
  }): Promise<boolean>;
  /** The user's personal team in the organization; throws `TeamNotFoundError`. */
  abstract getPersonalWorkspace(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalWorkspace>;
  abstract ensurePersonalWorkspace(input: {
    workspace: PersonalWorkspaceInput;
    resources: PersonalWorkspaceResourceIds;
  }): Promise<{
    workspace: PersonalWorkspace;
    created: boolean;
  }>;
  abstract getPersonalWorkspaceFeatureProject(
    projectId: string,
  ): Promise<PersonalWorkspaceFeatureProject>;
  abstract setPersonalWorkspaceFeaturesWithAudit(input: {
    projectId: string;
    callerUserId: string;
    organizationId: string | null;
    action: string;
    before: PersonalFeatures;
    after: PersonalFeatures;
  }): Promise<void>;
}
