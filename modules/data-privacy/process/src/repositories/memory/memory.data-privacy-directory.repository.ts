import type { DataPrivacyScope } from "@langwatch/data-privacy-contract";

import type {
  DataPrivacyDirectoryReader,
  DataPrivacyOrganizationDirectory,
  DataPrivacyProjectLineage,
} from "../../app/data-privacy.app.ts";

/** The directory's memory twin: one organization's lineage, seeded by whoever creates it. */
export class MemoryDataPrivacyDirectoryRepository implements DataPrivacyDirectoryReader {
  static create(
    rows: {
      lineage?: DataPrivacyProjectLineage;
      directory?: DataPrivacyOrganizationDirectory;
      scopeOrganizationId?: string | null;
    } = {},
  ): MemoryDataPrivacyDirectoryRepository {
    return new MemoryDataPrivacyDirectoryRepository(rows);
  }

  private constructor(
    private readonly rows: {
      lineage?: DataPrivacyProjectLineage;
      directory?: DataPrivacyOrganizationDirectory;
      scopeOrganizationId?: string | null;
    },
  ) {}

  async findProjectLineage(): Promise<DataPrivacyProjectLineage | null> {
    return this.rows.lineage ?? null;
  }

  async findOrganizationDirectory(): Promise<DataPrivacyOrganizationDirectory> {
    return this.rows.directory ?? { departments: [], teams: [], projects: [], groups: [] };
  }

  async findScopeOrganizationId(input: { scope: DataPrivacyScope }): Promise<string | null> {
    void input;
    return this.rows.scopeOrganizationId ?? null;
  }
}
