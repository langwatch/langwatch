/**
 * @vitest-environment node
 *
 * The two legs of the dataset cell upload on this process: composed over the
 * object store this deployment already has, and composed on a deployment that
 * has none, where the procedure still mounts and refuses by name.
 *
 * Spec: packages/features/dataset/specs/dataset-attachments.feature.
 */
import { DATASET_ATTACHMENT_PURPOSE } from "@langwatch/dataset-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import { HandledError } from "@langwatch/handled-error";
import type { StoredObjectsService } from "@langwatch/stored-object-server";
import { describe, expect, it, vi } from "vitest";

import type { ApiTrpcInfrastructure } from "../../../platform/infrastructure/api-trpc.infrastructure.ts";
import { composeDatasetFeature } from "../dataset.composition.ts";

const PROJECT_ID = "project-1";
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from("a tiny picture").toString("base64")}`;

/**
 * The composition reads `prisma` and `authz` only inside the closures the
 * batch-record ports and the permission probe are built from, and this suite
 * calls neither.
 */
const infrastructure = {} as unknown as ApiTrpcInfrastructure;

const peers = {
  datasets: {} as DatasetService,
  experimentLookup: {
    getById: async () => ({ name: null }),
    tryGetBySlug: async () => null,
  },
};

/** The code a refusal carries, which is what the editor branches on. */
async function codeOf(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    return HandledError.isHandled(error) ? error.code : undefined;
  }
  return undefined;
}

describe("composeDatasetFeature", () => {
  describe("given a process that composed an object store", () => {
    describe("when a person uploads a file into a cell", () => {
      /** @scenario "An uploaded file is kept and the cell gets a reference to it" */
      it("keeps the bytes in that store and answers with the cell's reference", async () => {
        const storeFromBytes = vi.fn(async () => ({
          id: "so_1",
          mediaType: "image/png",
          isDuplicate: false,
        }));
        const dataset = composeDatasetFeature({
          infrastructure,
          peers: { ...peers, storedObjects: { storeFromBytes } as unknown as StoredObjectsService },
        });

        const attachment = await dataset.app.uploadAttachment({
          projectId: PROJECT_ID,
          fileName: "photo.png",
          dataUrl: PNG_DATA_URL,
        });

        expect(storeFromBytes).toHaveBeenCalledWith(
          expect.objectContaining({ projectId: PROJECT_ID, purpose: DATASET_ATTACHMENT_PURPOSE }),
        );
        expect(attachment.url).toBe(`/api/files/${PROJECT_ID}/so_1`);
      });
    });
  });

  describe("given a process that composed no object store", () => {
    describe("when a person uploads a file into a cell", () => {
      /** @scenario "A deployment that keeps no stored objects refuses the upload by name" */
      it("still mounts the upload and refuses it by name", async () => {
        const dataset = composeDatasetFeature({ infrastructure, peers });

        const code = await codeOf(() =>
          dataset.app.uploadAttachment({
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
