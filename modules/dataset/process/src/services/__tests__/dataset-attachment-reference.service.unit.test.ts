import { createApiFixture } from "@langwatch/api-fixture";
import type { DatasetColumns } from "@langwatch/dataset-contract";
import {
  StoredObjectNotFoundError,
  type StoredObjectApi,
  type StoredObjectMetadata,
} from "@langwatch/stored-object-contract";
import { describe, expect, it, vi } from "vitest";

import { DatasetAttachmentReferenceService } from "../dataset-attachment-reference.service.ts";

const projectId = "project-1";
const columnTypes: DatasetColumns = [
  { name: "receipt", type: "image" },
  { name: "contract", type: "file" },
  { name: "note", type: "string" },
];

function stored(overrides: Partial<StoredObjectMetadata> = {}): StoredObjectMetadata {
  return {
    projectId,
    id: "object-1",
    sha256: "a".repeat(64),
    byteLength: 1024,
    mediaType: "image/png",
    filename: "receipt.png",
    mediaTypeVerified: true,
    status: "available",
    audiences: [],
    generation: 1,
    provenance: { purpose: "dataset_attachment", ownerKind: "dataset", ownerId: "dataset-1" },
    createdAt: "2026-09-24T00:00:00.000Z",
    ...overrides,
  };
}

function service(metadata: StoredObjectMetadata | Error) {
  const getMetadata = vi.fn(async () => {
    if (metadata instanceof Error) throw metadata;
    return metadata;
  });
  const references = DatasetAttachmentReferenceService.create({
    storedObjects: createApiFixture<StoredObjectApi>({ getMetadata }, "storedObjects"),
  });
  return { references, getMetadata };
}

const ref = (name: string, project = projectId) => `/api/files/${project}/object-1/${name}`;

describe("DatasetAttachmentReferenceService", () => {
  describe("when a cell names a file that was never confirmed", () => {
    it("refuses it as not confirmed, naming the cell's column", async () => {
      const { references } = service(stored({ status: "pending" }));

      await expect(
        references.assertAccepted({
          projectId,
          columnTypes,
          entries: [{ receipt: ref("receipt.png") }],
        }),
      ).rejects.toMatchObject({
        code: "dataset_attachment_reference_refused",
        meta: { reason: "not_confirmed", column: "receipt" },
      });
    });
  });

  describe("when a cell names a file uploaded for another purpose", () => {
    it("refuses it as the wrong purpose", async () => {
      const { references } = service(
        stored({
          mediaType: "text/csv",
          filename: "rows.csv",
          provenance: { purpose: "dataset_import", ownerKind: "dataset", ownerId: "d" },
        }),
      );

      await expect(
        references.assertAccepted({
          projectId,
          columnTypes,
          entries: [{ contract: ref("rows.csv") }],
        }),
      ).rejects.toMatchObject({
        code: "dataset_attachment_reference_refused",
        meta: { reason: "wrong_purpose", column: "contract" },
      });
    });
  });

  describe("when a cell names another project's file", () => {
    it("refuses it as not found without reading the other project's record", async () => {
      const { references, getMetadata } = service(stored({ projectId: "project-2" }));

      await expect(
        references.assertAccepted({
          projectId,
          columnTypes,
          entries: [{ contract: ref("contract.pdf", "project-2") }],
        }),
      ).rejects.toMatchObject({ meta: { reason: "not_found" } });
      expect(getMetadata).not.toHaveBeenCalled();
    });

    it("refuses a missing file as not found", async () => {
      const { references } = service(new StoredObjectNotFoundError());

      await expect(
        references.assertAccepted({ projectId, columnTypes, entries: [{ receipt: ref("a.png") }] }),
      ).rejects.toMatchObject({ meta: { reason: "not_found", column: "receipt" } });
    });
  });

  describe("when an image cell names a file that is not a picture", () => {
    it("refuses the media type", async () => {
      const { references } = service(
        stored({ mediaType: "application/pdf", filename: "contract.pdf" }),
      );

      await expect(
        references.assertAccepted({
          projectId,
          columnTypes,
          entries: [{ receipt: ref("contract.pdf") }],
        }),
      ).rejects.toMatchObject({ code: "dataset_attachment_type_refused" });
    });
  });

  describe("when a file cell names any kind of confirmed attachment", () => {
    it("accepts it", async () => {
      const { references } = service(
        stored({ mediaType: "application/pdf", filename: "contract.pdf" }),
      );

      await expect(
        references.assertAccepted({
          projectId,
          columnTypes,
          entries: [{ contract: ref("contract.pdf") }],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when cells hold links or inline pictures", () => {
    it("reads no stored record for them", async () => {
      const { references, getMetadata } = service(stored());

      await references.assertAccepted({
        projectId,
        columnTypes,
        entries: [{ receipt: "https://example.com/a.png", contract: "data:image/png;base64,AAAA" }],
      });

      expect(getMetadata).not.toHaveBeenCalled();
    });
  });

  describe("when the reference was already held by the record", () => {
    it("does not check it again", async () => {
      const { references, getMetadata } = service(stored({ status: "pending" }));

      await references.assertAccepted({
        projectId,
        columnTypes,
        entries: [{ receipt: ref("receipt.png") }],
        findHeld: async () => [{ receipt: ref("receipt.png") }],
      });

      expect(getMetadata).not.toHaveBeenCalled();
    });
  });
});
