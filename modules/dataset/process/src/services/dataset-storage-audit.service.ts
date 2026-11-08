import { PROJECT_ID_PAGE_LIMIT, type ProjectApi } from "@langwatch/project-contract";

import type {
  DatasetStorageAuditRepository,
  DatasetStorageLeftovers,
} from "../repositories/dataset-storage-audit.repository.ts";

type AuditProjects = Pick<ProjectApi, "listAllWithOrganization">;

/** One organization's leftovers; a project whose team is gone is filed under `null`. */
export type OrganizationDatasetStorage = DatasetStorageLeftovers & {
  organizationId: string | null;
};

export type DatasetStorageAuditReport = {
  /** Only the organizations with something left, in the order their projects were read. */
  organizations: OrganizationDatasetStorage[];
  totals: DatasetStorageLeftovers;
};

const NOTHING_LEFT: DatasetStorageLeftovers = {
  recordsTableDatasets: 0,
  recordsTableRows: 0,
  singleFileDatasets: 0,
  rowsAwaitingCleanup: 0,
  rowsUnderOtherProject: 0,
  orphanRows: 0,
};

/**
 * What every organization still keeps outside object-storage chunks: the preview an operator
 * reads before the moves, the single-file conversion or the records-table cleanup. It only reads;
 * upgrades run their steps with no dry run, so this is the one look ahead there is.
 */
export class DatasetStorageAuditService {
  static create(options: {
    repository: DatasetStorageAuditRepository;
    /** The owner of the project table, which names every project and its organization. */
    projects: AuditProjects;
  }): DatasetStorageAuditService {
    return new DatasetStorageAuditService(options.repository, options.projects);
  }

  private constructor(
    private readonly repository: DatasetStorageAuditRepository,
    private readonly projects: AuditProjects,
  ) {}

  async audit(input: { signal?: AbortSignal } = {}): Promise<DatasetStorageAuditReport> {
    const byOrganization = new Map<string | null, OrganizationDatasetStorage>();
    let after: string | undefined;
    do {
      const page = await this.projects.listAllWithOrganization({
        after,
        limit: PROJECT_ID_PAGE_LIMIT,
      });
      const owned = [
        ...page.projects.map((project) => ({
          id: project.id,
          organizationId: project.organizationId,
        })),
        ...page.orphanIds.map((id) => ({ id, organizationId: null })),
      ];
      for (const project of owned) {
        if (input.signal?.aborted) break;
        const leftovers = await this.repository.countLeftovers({ projectId: project.id });
        if (!hasLeftovers(leftovers)) continue;
        const organization = byOrganization.get(project.organizationId) ?? {
          organizationId: project.organizationId,
          ...NOTHING_LEFT,
        };
        byOrganization.set(project.organizationId, add(organization, leftovers));
      }
      after = page.next ?? undefined;
    } while (after !== undefined && !input.signal?.aborted);

    const organizations = [...byOrganization.values()];
    return {
      organizations,
      totals: organizations.reduce<DatasetStorageLeftovers>(add, { ...NOTHING_LEFT }),
    };
  }
}

function hasLeftovers(leftovers: DatasetStorageLeftovers): boolean {
  return Object.values(leftovers).some((count) => count > 0);
}

function add<T extends DatasetStorageLeftovers>(sum: T, more: DatasetStorageLeftovers): T {
  return {
    ...sum,
    recordsTableDatasets: sum.recordsTableDatasets + more.recordsTableDatasets,
    recordsTableRows: sum.recordsTableRows + more.recordsTableRows,
    singleFileDatasets: sum.singleFileDatasets + more.singleFileDatasets,
    rowsAwaitingCleanup: sum.rowsAwaitingCleanup + more.rowsAwaitingCleanup,
    rowsUnderOtherProject: sum.rowsUnderOtherProject + more.rowsUnderOtherProject,
    orphanRows: sum.orphanRows + more.orphanRows,
  };
}
