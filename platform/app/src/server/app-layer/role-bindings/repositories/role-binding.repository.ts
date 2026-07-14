import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";
import type { CustomRole, User } from "@prisma/client";

// A direct (user, not group) TEAM-scoped binding, shaped to populate the
// team-settings members list. Mirrors a legacy `TeamUser` row joined with its
// user and assigned custom role, so callers can render members the same way
// regardless of whether the membership predates the RoleBinding migration.
export type TeamScopedMemberBinding = {
  userId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  createdAt: Date;
  updatedAt: Date;
  user: User;
  customRole: CustomRole | null;
};

// Shared shape used by the org synthesis step
export type RoleBindingForSynthesis = {
  organizationId: string;
  scopeType: RoleBindingScopeType;
  scopeId: string;
  role: TeamUserRole;
  customRoleId: string | null;
  customRole: {
    id: string;
    name: string;
    description: string | null;
    permissions: unknown;
    organizationId: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
};

export interface RoleBindingRepository {
  listForOrganizationsAndUser(params: {
    orgIds: string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]>;

  // Direct user members of one or more teams, resolved from TEAM-scoped
  // RoleBindings — the authoritative membership source since the
  // TeamUser→RoleBinding migration (group-expanded members are intentionally
  // excluded; the team-settings page manages individual users only). Returns a
  // map keyed by teamId; every requested teamId is present (empty array if none).
  // A user may appear more than once per team (the partial unique indexes allow
  // a built-in plus a custom binding at the same scope) — callers dedupe.
  listTeamScopedUserBindingsByTeamIds(params: {
    organizationId: string;
    teamIds: string[];
  }): Promise<Map<string, TeamScopedMemberBinding[]>>;

  validateScopeInOrg(params: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<void>;
}

export class NullRoleBindingRepository implements RoleBindingRepository {
  async listForOrganizationsAndUser(_params: {
    orgIds: string[];
    userId: string;
  }): Promise<RoleBindingForSynthesis[]> {
    return [];
  }

  async listTeamScopedUserBindingsByTeamIds({
    teamIds,
  }: {
    organizationId: string;
    teamIds: string[];
  }): Promise<Map<string, TeamScopedMemberBinding[]>> {
    // Honor the contract: every requested teamId is present (empty array).
    return new Map(teamIds.map((teamId) => [teamId, []]));
  }

  async validateScopeInOrg(_params: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<void> {}
}
