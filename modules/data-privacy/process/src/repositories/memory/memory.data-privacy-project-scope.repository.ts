import {
  type DataPrivacyProjectKey,
  type DataPrivacyProjectScope,
  DataPrivacyProjectScopeRepository,
} from "../data-privacy-project-scope.repository.ts";

type StoredScope = {
  organizationId: string;
  teamId: string | null;
  isPersonal: boolean | null;
  departmentId: string | null;
  teamRecordedAtMs: number | null;
  departmentRecordedAtMs: number | null;
  archived: boolean;
};

/** In-memory twin of data privacy's Postgres fold of where each project sits. */
export class MemoryDataPrivacyProjectScopeRepository extends DataPrivacyProjectScopeRepository {
  private readonly rows = new Map<string, StoredScope>();

  static create(): MemoryDataPrivacyProjectScopeRepository {
    return new MemoryDataPrivacyProjectScopeRepository();
  }

  async find({ projectId }: { projectId: string }): Promise<DataPrivacyProjectScope | null> {
    const row = this.rows.get(projectId);
    if (!row) return null;
    return {
      projectId,
      organizationId: row.organizationId,
      teamId: row.teamId,
      isPersonal: row.isPersonal,
      departmentId: row.departmentId,
      archived: row.archived,
    };
  }

  async recordTeam({
    teamId,
    isPersonal,
    recordedAtMs,
    ...key
  }: DataPrivacyProjectKey & {
    teamId: string;
    isPersonal?: boolean;
    recordedAtMs: number;
  }): Promise<void> {
    const row = this.#ensure(key);
    if (isPersonal !== undefined) row.isPersonal = isPersonal;
    if (row.teamRecordedAtMs !== null && row.teamRecordedAtMs >= recordedAtMs) return;
    row.teamId = teamId;
    row.teamRecordedAtMs = recordedAtMs;
  }

  async recordDepartment({
    departmentId,
    recordedAtMs,
    ...key
  }: DataPrivacyProjectKey & { departmentId: string | null; recordedAtMs: number }): Promise<void> {
    const row = this.#ensure(key);
    if (row.departmentRecordedAtMs !== null && row.departmentRecordedAtMs >= recordedAtMs) return;
    row.departmentId = departmentId;
    row.departmentRecordedAtMs = recordedAtMs;
  }

  async recordArchived(key: DataPrivacyProjectKey & { archivedAtMs: number }): Promise<void> {
    this.#ensure(key).archived = true;
  }

  #ensure({ projectId, organizationId }: DataPrivacyProjectKey): StoredScope {
    const stored = this.rows.get(projectId);
    if (stored) return stored;
    const row: StoredScope = {
      organizationId,
      teamId: null,
      isPersonal: null,
      departmentId: null,
      teamRecordedAtMs: null,
      departmentRecordedAtMs: null,
      archived: false,
    };
    this.rows.set(projectId, row);
    return row;
  }
}
