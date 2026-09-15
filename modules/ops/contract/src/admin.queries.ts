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
  orgMemberships: {
    organization: BackofficeOrganizationRef & {
      teams: { projects: BackofficeProjectRef[] }[];
    };
  }[];
}

export type BackofficeUserRow = UserWithBackofficeIncludes & {
  organizations: BackofficeOrganizationRef[];
  projects: BackofficeProjectRef[];
};
