/** Where one project sits, as data privacy last folded project's facts. */
export type DataPrivacyProjectScope = Readonly<{
  projectId: string;
  organizationId: string;
  /** Null until a fact naming the team has folded (a created fact before 2026-10-06 names none). */
  teamId: string | null;
  isPersonal: boolean | null;
  departmentId: string | null;
  archived: boolean;
}>;

export type DataPrivacyProjectKey = Readonly<{ projectId: string; organizationId: string }>;

/**
 * Data privacy's fold of project's lifecycle facts, one row per project (Alex, 2026-10-06). Each
 * column group keeps the newer of the stored and given fact, so a late or repeated fact is inert.
 */
export abstract class DataPrivacyProjectScopeRepository {
  abstract find(input: { projectId: string }): Promise<DataPrivacyProjectScope | null>;
  abstract recordTeam(
    input: DataPrivacyProjectKey & { teamId: string; isPersonal?: boolean; recordedAtMs: number },
  ): Promise<void>;
  abstract recordDepartment(
    input: DataPrivacyProjectKey & { departmentId: string | null; recordedAtMs: number },
  ): Promise<void>;
  abstract recordArchived(input: DataPrivacyProjectKey & { archivedAtMs: number }): Promise<void>;
}
