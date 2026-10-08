/** Where one project sits, as project's row and its team's row place it. */
export type DataPrivacyProjectScope = Readonly<{
  projectId: string;
  organizationId: string;
  teamId: string;
  isPersonal: boolean;
  departmentId: string | null;
  archived: boolean;
}>;

/**
 * Project placement read through project's `Project` and organization's `Team` shares (round 46
 * E1, R40): no copy, so an existing project resolves on the first request after a deploy.
 */
export abstract class DataPrivacyProjectScopeRepository {
  /** Null when project's table holds no row for the id; an archived row is answered as archived. */
  abstract find(input: { projectId: string }): Promise<DataPrivacyProjectScope | null>;
}
