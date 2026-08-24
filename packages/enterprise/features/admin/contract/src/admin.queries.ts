export interface BackofficeOrganizationRef {
  id: string;
  name: string;
}

export interface BackofficeProjectRef {
  id: string;
  name: string;
  slug: string;
}

export interface UserWithBackofficeIncludes {
  id: string;
  [key: string]: unknown;
  orgMemberships: Array<{
    organization: BackofficeOrganizationRef & {
      teams: Array<{ projects: BackofficeProjectRef[] }>;
    };
  }>;
}

export type BackofficeUserRow = UserWithBackofficeIncludes & {
  organizations: BackofficeOrganizationRef[];
  projects: BackofficeProjectRef[];
};
