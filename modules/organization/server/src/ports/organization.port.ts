import type { PersonalWorkspaceResourceIds } from "../repositories/organization.repository.ts";

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
