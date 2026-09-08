/**
 * @vitest-environment node
 *
 * What happens to a file a person drops into a dataset cell: what is kept,
 * what the cell is told to point at, and the three refusals that carry a name
 * the editor can render words for.
 *
 * Spec: packages/features/dataset/specs/dataset-attachments.feature.
 */
import {
  DATASET_ATTACHMENT_MAX_BYTES,
  DATASET_ATTACHMENT_OWNER_KIND,
  DATASET_ATTACHMENT_PURPOSE,
} from "@langwatch/dataset-contract";
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";

import { UnavailableDatasetAttachmentStore } from "../../adapters/unavailable-dataset-attachment-store.adapter.ts";
import type { DatasetAttachmentStorePort } from "../../ports/dataset-attachment-store.port.ts";
import { DATASET_ATTACHMENT_FILE_NAME_MAX_LENGTH } from "../../rules/dataset-attachment.rules.ts";
import { DatasetAttachmentService } from "../dataset-attachment.service.ts";

const PROJECT_ID = "project-1";
const PNG_BYTES = Buffer.from("a tiny picture");
const PNG_DATA_URL = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;

/** A store that records what it was asked to keep and answers with a fixed id. */
function recordingStore() {
  const storeFromBytes = vi.fn(async (input: { mediaType: string }) => ({
    id: "so_1",
    mediaType: input.mediaType,
    isDuplicate: false,
  }));
  return {
    storeFromBytes,
    port: { storeFromBytes } as unknown as DatasetAttachmentStorePort,
  };
}

/** The code a refusal carries, which is what a caller branches on. */
async function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : undefined;
  }
  return undefined;
}

describe("DatasetAttachmentService", () => {
  describe("given the purpose the bytes are kept under", () => {
    /**
     * The `/api/files` route picks the read permission from this exact string
     * (`requiredPermissionForPurpose` in `@langwatch/stored-object-server`).
     * The two packages do not import each other, so both name the literal and
     * both tests fail if either side is renamed alone.
     */
    it("is the string the file read route guards with the dataset view permission", () => {
      expect(DATASET_ATTACHMENT_PURPOSE).toBe("dataset_attachment");
    });
  });

  describe("given a deployment that keeps stored objects", () => {
    describe("when a person uploads a picture", () => {
      /** @scenario "An uploaded file is kept and the cell gets a reference to it" */
      it("keeps the bytes under the attachment purpose and answers with the cell's reference", async () => {
        const store = recordingStore();
        const service = DatasetAttachmentService.create({ store: store.port });

        const attachment = await service.upload({
          projectId: PROJECT_ID,
          fileName: "photo.png",
          dataUrl: PNG_DATA_URL,
        });

        expect(store.storeFromBytes).toHaveBeenCalledWith({
          projectId: PROJECT_ID,
          purpose: DATASET_ATTACHMENT_PURPOSE,
          ownerKind: DATASET_ATTACHMENT_OWNER_KIND,
          ownerId: PROJECT_ID,
          mediaType: "image/png",
          bytes: PNG_BYTES,
        });
        expect(attachment).toEqual({
          id: "so_1",
          projectId: PROJECT_ID,
          url: `/api/files/${PROJECT_ID}/so_1`,
          fileName: "photo.png",
          mediaType: "image/png",
          sizeBytes: PNG_BYTES.length,
        });
      });
    });

    describe("when the browser sends a document as a generic binary", () => {
      /** @scenario "The media type is taken from the file name when the browser does not say" */
      it("keeps it under the media type the file name names", async () => {
        const store = recordingStore();
        const service = DatasetAttachmentService.create({ store: store.port });

        const attachment = await service.upload({
          projectId: PROJECT_ID,
          fileName: "report.pdf",
          dataUrl: `data:application/octet-stream;base64,${PNG_BYTES.toString("base64")}`,
        });

        expect(attachment.mediaType).toBe("application/pdf");
        expect(store.storeFromBytes).toHaveBeenCalledWith(
          expect.objectContaining({ mediaType: "application/pdf" }),
        );
      });
    });

    describe("when the reported file name carries a path", () => {
      /** @scenario "A file name that carries a path is reduced to the name alone" */
      it("keeps the last part of the name and bounds its length", async () => {
        const store = recordingStore();
        const service = DatasetAttachmentService.create({ store: store.port });

        const attachment = await service.upload({
          projectId: PROJECT_ID,
          fileName: `C:\\Users\\someone\\Desktop\\${"long".repeat(60)}.png`,
          dataUrl: PNG_DATA_URL,
        });

        expect(attachment.fileName).not.toContain("\\");
        expect(attachment.fileName).not.toContain("Desktop");
        expect(attachment.fileName.length).toBeLessThanOrEqual(
          DATASET_ATTACHMENT_FILE_NAME_MAX_LENGTH,
        );
        expect(attachment.fileName.endsWith(".png")).toBe(true);
      });
    });

    describe("when the body is not a base64 data URL", () => {
      /** @scenario "A file the browser could not read is refused" */
      it("refuses as unreadable and keeps nothing", async () => {
        const store = recordingStore();
        const service = DatasetAttachmentService.create({ store: store.port });

        const code = await codeOf(() =>
          service.upload({
            projectId: PROJECT_ID,
            fileName: "photo.png",
            dataUrl: "https://example.com/photo.png",
          }),
        );

        expect(code).toBe("dataset_attachment_unreadable");
        expect(store.storeFromBytes).not.toHaveBeenCalled();
      });
    });

    describe("when the file is larger than the attachment limit", () => {
      /** @scenario "A file larger than the attachment limit is refused" */
      it("refuses as too large before decoding and keeps nothing", async () => {
        const store = recordingStore();
        const service = DatasetAttachmentService.create({ store: store.port });
        const oversize = "A".repeat(Math.ceil((DATASET_ATTACHMENT_MAX_BYTES + 1024) / 3) * 4);

        const code = await codeOf(() =>
          service.upload({
            projectId: PROJECT_ID,
            fileName: "huge.pdf",
            dataUrl: `data:application/pdf;base64,${oversize}`,
          }),
        );

        expect(code).toBe("dataset_attachment_too_large");
        expect(store.storeFromBytes).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a deployment that composed no object storage", () => {
    describe("when a person uploads a file", () => {
      /** @scenario "A deployment that keeps no stored objects refuses the upload by name" */
      it("refuses by name rather than answering with a broken reference", async () => {
        const service = DatasetAttachmentService.create({
          store: UnavailableDatasetAttachmentStore.create(),
        });

        const code = await codeOf(() =>
          service.upload({
            projectId: PROJECT_ID,
            fileName: "photo.png",
            dataUrl: PNG_DATA_URL,
          }),
        );

        expect(code).toBe("dataset_attachment_storage_unavailable");
      });
    });
  });
});
