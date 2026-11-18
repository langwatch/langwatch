/**
 * @vitest-environment node
 * The storage audit over the memory twin: each organization's leftovers summed across its
 * projects and the project pages, a project with no team filed under no organization.
 */
import type { ProjectApi, ProjectOrganizationPage } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryDatasetStorageAuditRepository } from "../../repositories/memory/memory.dataset-storage-audit.repository.ts";
import { MemoryDatasetDatabase } from "../../repositories/memory/memory.dataset.database.ts";
import { DatasetStorageAuditService } from "../dataset-storage-audit.service.ts";

const NOTHING = {
  recordsTableDatasets: 0,
  recordsTableRows: 0,
  singleFileDatasets: 0,
  rowsAwaitingCleanup: 0,
  rowsUnderOtherProject: 0,
  orphanRows: 0,
};

let database: MemoryDatasetDatabase;

beforeEach(() => {
  database = MemoryDatasetDatabase.create();
});

/** Rows filed under `projectId` whose dataset is gone: the simplest leftover to count. */
function orphanRows(projectId: string, count: number): void {
  for (let index = 0; index < count; index++) {
    database.putRecord({
      id: `${projectId}-${index}`,
      datasetId: `${projectId}-gone`,
      projectId,
      entry: {},
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
  }
}

/** The audit over the memory twin, reading the project pages in order, keyed by cursor. */
function auditOver(pages: Record<string, ProjectOrganizationPage>) {
  const reads: (string | undefined)[] = [];
  const projects = createApiFixture<ProjectApi>(
    {
      listAllWithOrganization: async (input) => {
        reads.push(input?.after);
        return pages[input?.after ?? "start"]!;
      },
    },
    "projects",
  );
  const audit = DatasetStorageAuditService.create({
    repository: MemoryDatasetStorageAuditRepository.create({ database }),
    projects,
  });
  return { audit, reads };
}

describe("DatasetStorageAuditService.audit", () => {
  describe("given two organizations whose projects span two pages, and a project with no team", () => {
    const pages: Record<string, ProjectOrganizationPage> = {
      start: {
        projects: [
          { id: "a-1", organizationId: "org-a" },
          { id: "b-1", organizationId: "org-b" },
        ],
        orphanIds: ["no-team"],
        next: "b-1",
      },
      "b-1": {
        projects: [
          { id: "a-2", organizationId: "org-a" },
          { id: "c-1", organizationId: "org-c" },
        ],
        orphanIds: [],
        next: null,
      },
    };

    beforeEach(() => {
      orphanRows("a-1", 1);
      orphanRows("a-2", 2);
      orphanRows("b-1", 4);
      orphanRows("no-team", 8);
    });

    /** @scenario "The dataset storage audit sums each organization's projects across pages" */
    it("sums each organization's projects, across pages too", async () => {
      const { audit, reads } = auditOver(pages);

      const report = await audit.audit();

      expect(reads).toEqual([undefined, "b-1"]);
      expect(report.organizations).toContainEqual({
        ...NOTHING,
        organizationId: "org-a",
        orphanRows: 3,
      });
      expect(report.organizations).toContainEqual({
        ...NOTHING,
        organizationId: "org-b",
        orphanRows: 4,
      });
    });

    /** @scenario "The dataset storage audit sums each organization's projects across pages" */
    it("files the project with no team under no organization", async () => {
      const { audit } = auditOver(pages);

      const report = await audit.audit();

      expect(report.organizations).toContainEqual({
        ...NOTHING,
        organizationId: null,
        orphanRows: 8,
      });
    });

    /** @scenario "The dataset storage audit sums each organization's projects across pages" */
    it("leaves out an organization with nothing left and totals the rest", async () => {
      const { audit } = auditOver(pages);

      const report = await audit.audit();

      expect(report.organizations.map((organization) => organization.organizationId)).toEqual([
        "org-a",
        "org-b",
        null,
      ]);
      expect(report.totals).toEqual({ ...NOTHING, orphanRows: 15 });
    });
  });

  describe("given the audit is aborted", () => {
    it("reads no further page", async () => {
      const { audit, reads } = auditOver({
        start: { projects: [{ id: "a-1", organizationId: "org-a" }], orphanIds: [], next: "a-1" },
        "a-1": { projects: [], orphanIds: [], next: null },
      });
      const controller = new AbortController();
      controller.abort();

      await audit.audit({ signal: controller.signal });

      expect(reads).toEqual([undefined]);
    });
  });
});
