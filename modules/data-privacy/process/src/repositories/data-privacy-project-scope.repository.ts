/** Where one project sits; a personal project's department is its owner's membership's. */
export type DataPrivacyProjectScope = Readonly<{
  projectId: string;
  organizationId: string;
  teamId: string;
  isPersonal: boolean;
  departmentId: string | null;
}>;

/**
 * Project placement read through the `Project`, `Team` and `OrganizationUser` shares (round 46
 * E1, R40): no copy, so an existing project resolves on the first request after a deploy.
 */
export abstract class DataPrivacyProjectScopeRepository {
  /** Null when project's table holds no row for the id or its team; archived rows are answered. */
  abstract find(input: { projectId: string }): Promise<DataPrivacyProjectScope | null>;
}
