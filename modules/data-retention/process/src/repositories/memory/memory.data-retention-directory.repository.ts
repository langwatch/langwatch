import type { ScopeAssignment } from "@langwatch/data-retention-contract";

import type {
  DataRetentionDirectoryReader,
  RetentionOrganizationDirectory,
  RetentionProjectLineage,
} from "../../app/data-retention.app.ts";

type MemoryDirectoryRows = Readonly<{
  lineage?: RetentionProjectLineage;
  directory?: RetentionOrganizationDirectory;
  scopeOrganizationId?: string | null;
  scopeProjects?: readonly { id: string; teamId: string }[];
}>;

/** The directory's memory twin: one organization's lineage, seeded by whoever creates it. */
export class MemoryDataRetentionDirectoryRepository implements DataRetentionDirectoryReader {
  static create(rows: MemoryDirectoryRows = {}): MemoryDataRetentionDirectoryRepository {
    return new MemoryDataRetentionDirectoryRepository(rows);
  }

  private constructor(private readonly rows: MemoryDirectoryRows) {}

  async findProjectLineage(input: { projectId: string }): Promise<RetentionProjectLineage | null> {
    const lineage = this.rows.lineage;
    return lineage?.projectId === input.projectId ? lineage : null;
  }

  async findOrganizationDirectory(): Promise<RetentionOrganizationDirectory> {
    return this.rows.directory ?? { teams: [], projects: [] };
  }

  async findScopeOrganizationId(input: { scope: ScopeAssignment }): Promise<string | null> {
    void input;
    return this.rows.scopeOrganizationId ?? null;
  }

  async findScopeProjects(): Promise<readonly { id: string; teamId: string }[]> {
    return this.rows.scopeProjects ?? [];
  }
}
