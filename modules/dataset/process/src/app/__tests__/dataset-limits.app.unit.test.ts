/**
 * @vitest-environment node
 * The dataset limits as the application answers them: each organization's own
 * numbers, and the refusals a read or a write past them gets.
 */
import { DATASET_DEFAULT_LIMITS } from "@langwatch/dataset-contract";
import { deriveDatasetBounds } from "@langwatch/plans";
import type { ProjectApi } from "@langwatch/project-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  createDatasetTestApp,
  createDatasetTestEntitlementPerOrganization,
  createDatasetTestEntitlementWith,
} from "./dataset.fixture.ts";

const MIB = 1024 * 1024;
const RAISED_BYTES = 40 * MIB;

const ORGANIZATION_OF: Readonly<Record<string, string>> = {
  "project-raised": "organization-raised",
  "project-default": "organization-default",
};

/** Two projects, one in an organization whose per-file limit was raised to 40 MB. */
function twoOrganizations() {
  const createUpload = vi.fn(async () => ({
    objectId: "object-1",
    uploadUrl: "https://storage.test/upload",
    method: "PUT" as const,
    headers: {},
    expiresAt: "2026-10-06T00:00:00.000Z",
  }));
  const projects = Object.assign(createApiFixture<ProjectApi>(), {
    getOrganizationId: vi.fn(async (projectId: string) => ORGANIZATION_OF[projectId]!),
  });
  const app = createDatasetTestApp({
    dependencies: {
      projects,
      entitlement: createDatasetTestEntitlementPerOrganization({
        "organization-raised": RAISED_BYTES,
      }),
      storedObjects: createApiFixture<StoredObjectApi>(
        { createUpload: createUpload as never },
        "storedObjects",
      ),
    },
  });

  return { app, createUpload };
}

const picture = (projectId: string) => ({
  projectId,
  filename: "scan.png",
  mediaType: "image/png",
  byteLength: 30 * MIB,
});

/** A dataset of `rows` rows of about `rowBytes` each, in an organization on the given limits. */
async function datasetOf(input: {
  rows: number;
  rowBytes: number;
  limits: Parameters<typeof createDatasetTestEntitlementWith>[0];
}) {
  const app = createDatasetTestApp({
    dependencies: { entitlement: createDatasetTestEntitlementWith(input.limits) },
  });
  const dataset = await app.upsertDataset({
    projectId: "project-1",
    name: "Scans",
    columnTypes: [{ name: "text", type: "string" }],
  });
  for (let row = 0; row < input.rows; row++) {
    await app.batchCreateRecords({
      projectId: "project-1",
      slugOrId: dataset.id,
      entries: [{ text: `${row}:${"x".repeat(input.rowBytes)}` }],
    });
  }

  return { app, dataset };
}

describe("the dataset limits an application answers", () => {
  describe("given a dataset of more rows than one batch moves", () => {
    describe("when it is copied to another project", () => {
      /** @scenario "A copy carries every row of the dataset" */
      it("copies every row", async () => {
        const app = createDatasetTestApp();
        const source = await app.upsertDataset({
          projectId: "project-1",
          name: "Scans",
          columnTypes: [{ name: "text", type: "string" }],
        });
        await app.batchCreateRecords({
          projectId: "project-1",
          slugOrId: source.id,
          entries: Array.from({ length: 450 }, (_, row) => ({ text: `row ${row}` })),
        });

        const copy = await app.copyDataset({
          sourceDatasetId: source.id,
          sourceProjectId: "project-1",
          targetProjectId: "project-2",
        });

        const page = await app.listRecords({ projectId: "project-2", slugOrId: copy.id, limit: 1 });
        expect(page.pagination.total).toBe(450);
      });
    });
  });

  describe("given one organization with a raised per-file limit and one on the defaults", () => {
    describe("when each asks for its dataset limits", () => {
      /** @scenario "A project answers the limits of its own organization" */
      it("answers each organization its own numbers", async () => {
        const { app } = twoOrganizations();
        const raised = deriveDatasetBounds(RAISED_BYTES);

        await expect(app.getLimits({ projectId: "project-raised" })).resolves.toMatchObject({
          attachmentBytes: RAISED_BYTES,
          rowBytes: raised.datasetRowBytes,
          fileBytes: raised.datasetFileBytes,
          inlineReadBytes: raised.datasetInlineReadBytes,
          wholeReadBytes: raised.datasetWholeReadBytes,
        });
        await expect(app.getLimits({ projectId: "project-default" })).resolves.toEqual(
          DATASET_DEFAULT_LIMITS,
        );
      });
    });

    describe("when the raised organization asks to upload a 30 MB picture", () => {
      /** @scenario "An organization with a raised per-file limit attaches a file above 20 MB" */
      it("is given an upload address that accepts the organization's limit", async () => {
        const { app, createUpload } = twoOrganizations();

        await expect(app.createAttachmentUpload(picture("project-raised"))).resolves.toMatchObject({
          objectId: "object-1",
        });
        expect(createUpload).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "project-raised",
            purpose: "dataset_attachment",
            byteLength: 30 * MIB,
            maxBytes: RAISED_BYTES,
          }),
        );
      });
    });

    describe("when the default organization asks to upload the same picture", () => {
      /** @scenario "An organization on the default limit is refused the same file before any byte is sent" */
      it("is refused naming 20 MB, and no upload address is made", async () => {
        const { app, createUpload } = twoOrganizations();

        await expect(app.createAttachmentUpload(picture("project-default"))).rejects.toMatchObject({
          code: "dataset_attachment_too_large",
          meta: { maxBytes: 20 * MIB },
        });
        expect(createUpload).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a dataset larger than one response carries", () => {
    const limits = { inlineReadBytes: 2500 };

    describe("when the whole dataset is read in one call", () => {
      /** @scenario "Reading a whole dataset too large for one response is refused and names paging" */
      it("refuses with the paging refusal instead of a partial list", async () => {
        const { app, dataset } = await datasetOf({ rows: 5, rowBytes: 1000, limits });

        await expect(
          app.getDatasetWithinLimit({ projectId: "project-1", slugOrId: dataset.id }),
        ).rejects.toMatchObject({
          code: "dataset_too_large_to_read_inline",
          httpStatus: 400,
          meta: { maxBytes: 2500, totalRows: 5 },
        });
      });

      it("answers a dataset that fits whole", async () => {
        const { app, dataset } = await datasetOf({ rows: 2, rowBytes: 1000, limits });

        const read = await app.getDatasetWithinLimit({
          projectId: "project-1",
          slugOrId: dataset.id,
        });

        expect(read.records).toHaveLength(2);
      });
    });

    describe("when the dataset editor loads its rows", () => {
      /** @scenario "A read that stops early reports how many rows it loaded" */
      it("says it stopped early, with the rows loaded and the rows the dataset holds", async () => {
        const { app, dataset } = await datasetOf({ rows: 5, rowBytes: 1000, limits });

        const read = await app.getDatasetWithRecords({
          projectId: "project-1",
          slugOrId: dataset.id,
        });

        expect(read.truncated).toBe(true);
        expect(read.records).toHaveLength(2);
        expect(read.totalRows).toBe(5);
      });
    });

    describe("when every row is asked for, as a download does", () => {
      /** @scenario "A download reads every row of a dataset within the whole-read limits" */
      it("reads every row past the inline budget", async () => {
        const { app, dataset } = await datasetOf({ rows: 5, rowBytes: 1000, limits });

        const read = await app.getDatasetWithRecords({
          projectId: "project-1",
          slugOrId: dataset.id,
          limitMb: null,
        });

        expect(read.truncated).toBe(false);
        expect(read.records).toHaveLength(5);
        expect(read.totalRows).toBe(5);
      });

      /** @scenario "A download of a dataset larger than the whole-read limits is refused, never cut" */
      it("refuses a dataset that holds more bytes than a whole read carries", async () => {
        const { app, dataset } = await datasetOf({
          rows: 5,
          rowBytes: 1000,
          limits: { wholeReadBytes: 3500 },
        });

        await expect(
          app.getDatasetWithRecords({
            projectId: "project-1",
            slugOrId: dataset.id,
            limitMb: null,
          }),
        ).rejects.toMatchObject({
          code: "dataset_too_large_to_export",
          httpStatus: 413,
          meta: { maxBytes: 3500 },
        });
      });

      /** @scenario "A download of a dataset larger than the whole-read limits is refused, never cut" */
      it("refuses a dataset that holds more rows than a whole read carries", async () => {
        const { app, dataset } = await datasetOf({ rows: 5, rowBytes: 10, limits: { rowsMax: 4 } });

        await expect(
          app.getDatasetWithRecords({
            projectId: "project-1",
            slugOrId: dataset.id,
            limitMb: null,
          }),
        ).rejects.toMatchObject({
          code: "dataset_too_large_to_export",
          meta: { rowCount: 5, maxRows: 4 },
        });
      });
    });

    describe("when a page of rows larger than one response is asked for", () => {
      /** @scenario "A page of rows too large for one response names a page size that fits" */
      it("refuses with a smaller page size, and following it reaches every row", async () => {
        const { app, dataset } = await datasetOf({ rows: 6, rowBytes: 1000, limits });
        const lookup = { projectId: "project-1", slugOrId: dataset.id };

        const refusal = await app
          .listRecords({ ...lookup, page: 1, limit: 6 })
          .catch((error) => error);

        expect(refusal).toMatchObject({
          code: "dataset_page_too_large",
          httpStatus: 413,
          meta: { maxBytes: 2500, page: 1, limit: 6, suggestedLimit: 2, suggestedPage: 1 },
        });
        const { suggestedLimit } = refusal.meta as { suggestedLimit: number };
        const seen: string[] = [];
        for (let page = 1; page <= 6 / suggestedLimit; page++) {
          const answer = await app.listRecords({ ...lookup, page, limit: suggestedLimit });
          seen.push(...answer.data.map((record) => record.id));
        }
        expect(new Set(seen).size).toBe(6);
      });

      it("names the page that continues from the rows already read", async () => {
        const { app, dataset } = await datasetOf({ rows: 12, rowBytes: 1000, limits });

        await expect(
          app.listRecords({ projectId: "project-1", slugOrId: dataset.id, page: 2, limit: 6 }),
        ).rejects.toMatchObject({ meta: { suggestedLimit: 2, suggestedPage: 4 } });
      });
    });

    describe("when a page of one row larger than one response is asked for", () => {
      /** @scenario "A page holding a single row is always answered" */
      it("answers the row", async () => {
        const { app, dataset } = await datasetOf({ rows: 2, rowBytes: 5000, limits });

        const page = await app.listRecords({
          projectId: "project-1",
          slugOrId: dataset.id,
          page: 2,
          limit: 1,
        });

        expect(page.data).toHaveLength(1);
      });
    });

    describe("when a page that fits is asked for", () => {
      /** @scenario "A page of rows carries the dataset it belongs to" */
      it("carries the dataset beside the rows", async () => {
        const { app, dataset } = await datasetOf({ rows: 2, rowBytes: 100, limits });

        const page = await app.listRecords({ projectId: "project-1", slugOrId: dataset.id });

        expect(page.dataset).toMatchObject({
          id: dataset.id,
          name: "Scans",
          slug: dataset.slug,
          columnTypes: [{ name: "text", type: "string" }],
        });
      });
    });
  });
});
