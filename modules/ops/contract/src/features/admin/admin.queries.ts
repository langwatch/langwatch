export interface AdminOrganizationRef {
  id: string;
  name: string;
}

export interface AdminProjectRef {
  id: string;
  name: string;
  slug: string;
}

export interface UserWithAdminIncludes {
  id: string;
  [key: string]: unknown;
  orgMemberships: {
    organization: AdminOrganizationRef & {
      teams: { projects: AdminProjectRef[] }[];
    };
  }[];
}

export type AdminUserRow = UserWithAdminIncludes & {
  organizations: AdminOrganizationRef[];
  projects: AdminProjectRef[];
};
