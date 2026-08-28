import type {
  PersonalFeatures,
  PersonalWorkspace,
  PersonalWorkspaceInput,
  OrganizationBillingProfile,
  OrganizationIntent,
  OrganizationSettings,
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
  createdAt: Date;
  updatedAt: Date;
};

export abstract class OrganizationRepository {
  abstract getSettings(organizationId: string): Promise<OrganizationSettings | null>;
  abstract findSettings(organizationId: string): Promise<StoredOrganizationSettings | null>;
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

export abstract class OrganizationSettingsSecretPort {
  abstract encrypt(value: string): string;
  abstract decrypt(value: string): string;
}

export abstract class PersonalWorkspaceIdentityPort {
  abstract create(input: { userId: string; organizationId: string }): PersonalWorkspaceResourceIds;
}

export abstract class PersonalWorkspaceDiagnosticsPort {
  abstract warn(message: string, context: Record<string, unknown>): void;
}

export abstract class TeamIdentityPort {
  abstract createTeam(input: { name: string }): {
    teamId: string;
    slug: string;
  };
  abstract createBindingId(): string;
}

export abstract class GroupIdentityPort {
  abstract createGroupId(): string;
  abstract createBindingId(): string;
  abstract slugify(name: string): string;
}
