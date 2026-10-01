import { createApiFixture } from "@langwatch/api-fixture";
import {
  DATASET_ATTACHMENT_MAX_BYTES,
  type StoreDatasetAttachmentUploadInput,
} from "@langwatch/dataset-contract";
import type {
  StoreStoredObjectFromBytesInput,
  StoredObjectApi,
} from "@langwatch/stored-object-contract";
import { describe, expect, it } from "vitest";

import { DatasetAttachmentUploadService } from "../dataset-attachment-upload.service.ts";

const projectId = "project-1";

async function* bytesOf(text: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(text);
}

function upload(
  overrides: Partial<StoreDatasetAttachmentUploadInput> = {},
): StoreDatasetAttachmentUploadInput {
  return {
    projectId,
    datasetId: "dataset-1",
    filename: "receipt.png",
    mediaType: "image/png",
    bytes: bytesOf("png"),
    fileSize: 3,
    ...overrides,
  };
}

function service() {
  const stores: StoreStoredObjectFromBytesInput[] = [];
  const storedObjects = createApiFixture<StoredObjectApi>(
    {
      storeFromBytes: async (input) => {
        stores.push(input);
        return {
          isDuplicate: false,
          reference: {
            projectId,
            id: "object-1",
            sha256: "a".repeat(64),
            byteLength: 3,
            filename: input.filename,
            mediaType: input.mediaType,
            audience: input.audience,
          },
        };
      },
    },
    "storedObjects",
  );
  return { stores, attachments: DatasetAttachmentUploadService.create({ storedObjects }) };
}

describe("DatasetAttachmentUploadService", () => {
  describe("when a file is posted to the deprecated attachments address", () => {
    /** @scenario "Posting a file to the dataset attachments address still works and is marked deprecated" */
    it("stores it as a dataset attachment and answers the reference a cell holds", async () => {
      const { stores, attachments } = service();

      await expect(attachments.store(upload())).resolves.toEqual({
        url: "/api/files/project-1/object-1/receipt.png",
        name: "receipt.png",
        mediaType: "image/png",
        sizeBytes: 3,
      });
      expect(stores).toMatchObject([
        {
          projectId,
          purpose: "dataset_attachment",
          ownerKind: "dataset",
          ownerId: "dataset-1",
          audience: "datasets:view",
        },
      ]);
    });

    it("owns a draft's file inline and names it by the read path's allowlist", async () => {
      const { stores, attachments } = service();

      const stored = await attachments.store(
        upload({ datasetId: " ", filename: "my receipt.png", mediaType: undefined }),
      );

      expect(stored).toMatchObject({
        name: "my_receipt.png",
        mediaType: "application/octet-stream",
      });
      expect(stores[0]?.ownerId).toBe("inline");
    });
  });

  describe("when the posted file is refused", () => {
    /** @scenario "The dataset attachments address refuses a file a browser can run" */
    it("refuses a media type a browser can run before storing anything", async () => {
      const { stores, attachments } = service();

      await expect(
        attachments.store(upload({ filename: "page.html", mediaType: "text/html; charset=utf-8" })),
      ).rejects.toMatchObject({ code: "dataset_attachment_type_refused", httpStatus: 415 });
      expect(stores).toEqual([]);
    });

    /** @scenario "The dataset attachments address refuses a file over the attachment limit" */
    it("refuses a file over the attachment limit before storing anything", async () => {
      const { stores, attachments } = service();

      await expect(
        attachments.store(upload({ fileSize: DATASET_ATTACHMENT_MAX_BYTES + 1 })),
      ).rejects.toMatchObject({ code: "dataset_attachment_too_large", httpStatus: 413 });
      expect(stores).toEqual([]);
    });
  });
});
