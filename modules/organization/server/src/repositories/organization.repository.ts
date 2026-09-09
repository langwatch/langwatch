import type {
  OrganizationBillingProfile,
  OrganizationIntent,
  OrganizationSettings,
  PersonalFeatures,
  PersonalWorkspace,
  PersonalWorkspaceInput,
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
 * service's, over this raw read, since encryption is an infrastructure
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
  /** Returns the oldest team or throws OrganizationHasNoTeamError. */
  abstract getOldestTeamId(organizationId: string): Promise<string>;
  abstract getBillingProfile(organizationId: string): Promise<OrganizationBillingProfile>;
  abstract claimBillingCustomerId(input: {
    organizationId: string;
    billingCustomerId: string;
  }): Promise<boolean>;
  abstract tryFindPersonalWorkspace(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalWorkspace | null>;
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
