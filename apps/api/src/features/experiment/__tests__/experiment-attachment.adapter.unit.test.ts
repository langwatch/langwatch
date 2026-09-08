/**
 * Which stored objects a run may read as a dataset attachment, and what it does
 * on a deployment that composed no object store.
 * @see specs/experiments-v3/dataset-attachments.feature
 */
import { DATASET_ATTACHMENT_PURPOSE } from "@langwatch/dataset-contract";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  ApiExperimentAttachmentAdapter,
  type ApiExperimentAttachmentObjectReader,
} from "../experiment-attachment.adapter.ts";

const PROJECT = "project_1";

const row = (overrides: Record<string, unknown>) => ({
  id: "obj_1",
  project_id: PROJECT,
  purpose: DATASET_ATTACHMENT_PURPOSE,
  owner_kind: DATASET_ATTACHMENT_PURPOSE,
  owner_id: PROJECT,
  media_type: "image/png",
  size_bytes: 8,
  sha256: "abc",
  storage_uri: "file://abc",
  created_at: new Date(0),
  inserted_at: new Date(0),
  ...overrides,
});

const storeHolding = (result: unknown): ApiExperimentAttachmentObjectReader =>
  ({
    tryGetById: vi.fn<() => Promise<unknown>>(async () => result),
  }) as unknown as ApiExperimentAttachmentObjectReader;

describe("given a deployment with an object store", () => {
  describe("when the run reads a dataset attachment", () => {
    /** @scenario "An uploaded picture in an image column reaches the target as its bytes" */
    it("returns the whole object and its media type", async () => {
      const adapter = ApiExperimentAttachmentAdapter.create({
        storedObjects: () =>
          storeHolding({ row: row({}), stream: Readable.from([Buffer.from("PNGBYTES")]) }),
      });

      const read = await adapter.tryRead({ projectId: PROJECT, id: "obj_1" });

      expect(read?.mediaType).toBe("image/png");
      expect(read?.bytes.toString()).toBe("PNGBYTES");
    });

    /** @scenario "A reference to another project's attachment is left as text" */
    it("returns nothing for a row that is not a dataset attachment", async () => {
      const adapter = ApiExperimentAttachmentAdapter.create({
        storedObjects: () =>
          storeHolding({
            row: row({ purpose: "trace_content" }),
            stream: Readable.from([Buffer.from("SECRET")]),
          }),
      });

      expect(await adapter.tryRead({ projectId: PROJECT, id: "obj_1" })).toBeNull();
    });

    /** @scenario "A reference whose bytes the deployment no longer holds is left as text" */
    it("returns nothing for a row whose bytes the storage no longer holds", async () => {
      const adapter = ApiExperimentAttachmentAdapter.create({
        storedObjects: () => storeHolding({ row: row({}), status: "missing" }),
      });

      expect(await adapter.tryRead({ projectId: PROJECT, id: "obj_1" })).toBeNull();
    });
  });
});

describe("given a deployment that composed no object store", () => {
  describe("when the run reads a dataset attachment", () => {
    /** @scenario "A deployment with no object store leaves every reference as text" */
    it("returns nothing rather than failing the run", async () => {
      const adapter = ApiExperimentAttachmentAdapter.create({ storedObjects: () => undefined });

      expect(await adapter.tryRead({ projectId: PROJECT, id: "obj_1" })).toBeNull();
    });

    /** @scenario "A deployment with no object store leaves every reference as text" */
    it("returns nothing when the composed store refuses by name", async () => {
      const adapter = ApiExperimentAttachmentAdapter.create({
        storedObjects: () => {
          throw new Error("The object store is not available on this deployment.");
        },
      });

      expect(await adapter.tryRead({ projectId: PROJECT, id: "obj_1" })).toBeNull();
    });
  });
});
