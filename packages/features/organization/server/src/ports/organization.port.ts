import type {
  PersonalFeatures,
  PersonalWorkspace,
  PersonalWorkspaceInput,
  OrganizationBillingProfile,
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

export abstract class OrganizationRepository {
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

export abstract class PersonalWorkspaceIdentityPort {
  abstract create(input: {
    userId: string;
    organizationId: string;
  }): PersonalWorkspaceResourceIds;
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
