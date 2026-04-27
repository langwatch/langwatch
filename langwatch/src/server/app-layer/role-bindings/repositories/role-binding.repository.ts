import { RoleBindingScopeType, TeamUserRole } from "@prisma/client";

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

  async validateScopeInOrg(_params: {
    organizationId: string;
    scopeType: RoleBindingScopeType;
    scopeId: string;
  }): Promise<void> {}
}
