/**
 * @see modules/langy/specs/langy-image-attachments.feature
 */
import type { HandledError } from "@langwatch/handled-error";
import type { LangyAttachmentRef } from "@langwatch/langy-contract";
import {
  STORED_OBJECT_DELIVERY_AUDIENCES,
  type StoredObjectApi,
  type StoredObjectMetadata,
  type StoredObjectReference,
  storedObjectReferenceSchema,
  StoredObjectNotFoundError,
  storedObjectMetadataSchema,
} from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type {
  LangyDispatchOutcome,
  LangyWorker,
  LangyWorkerDispatchInput,
} from "../../../../channels/langy-worker.channel.ts";
import { LangyAttachmentService } from "../langy-attachment.service.ts";

const PROJECT = "project_1";
const MIB = 1024 * 1024;

function metadataOf({
  purpose = "langy_attachment",
  projectId = PROJECT,
}: { purpose?: string; projectId?: string } = {}): StoredObjectMetadata {
  return storedObjectMetadataSchema.parse({
    projectId,
    id: "storedobject_a",
    sha256: "0".repeat(64),
    byteLength: 4,
    mediaType: "image/png",
    filename: "pasted-1a2b3c.png",
    mediaTypeVerified: true,
    status: "available",
    audiences: [],
    generation: 1,
    provenance: { purpose, ownerKind: "project", ownerId: projectId },
    createdAt: "2026-11-25T00:00:00.000Z",
  });
}

function referenceOf(): StoredObjectReference {
  const { projectId, id, sha256, byteLength, filename, mediaType } = metadataOf();
  return storedObjectReferenceSchema.parse({
    projectId,
    id,
    sha256,
    byteLength,
    filename,
    mediaType,
    audience: STORED_OBJECT_DELIVERY_AUDIENCES[0],
  });
}

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

async function* bytesOf(bytes: Uint8Array) {
  yield bytes;
}

function refusalOf(error: unknown): { code?: string; reason?: unknown } {
  const handled = error as HandledError;
  return { code: handled.code, reason: (handled.meta as { reason?: unknown } | undefined)?.reason };
}

class RecordingWorker implements LangyWorker {
  readonly dispatched: LangyWorkerDispatchInput[] = [];
  async probe() {
    return true;
  }
  async warm() {}
  async cancel() {}
  async dispatch(input: LangyWorkerDispatchInput): Promise<LangyDispatchOutcome> {
    this.dispatched.push(input);
    return "accepted";
  }
}

const dispatchInput = (imageRefs: readonly LangyAttachmentRef[]): LangyWorkerDispatchInput => ({
  intent: "create",
  conversationId: "conv_1",
  turnId: "turn_1",
  projectId: PROJECT,
  userId: "user_1",
  runToken: "run",
  prompt: "what is in [▣ pasted-1a2b3c.png]?",
  system: "",
  credentials: {},
  imageRefs,
});

const ref: LangyAttachmentRef = {
  objectId: "storedobject_a",
  filename: "pasted-1a2b3c.png",
  mediaType: "image/png",
};

describe("LangyAttachmentService", () => {
  describe("given a person in a project with Langy", () => {
    /** @scenario An image upload is created for the langy_attachment purpose */
    it("asks stored objects for a langy_attachment upload and answers its signed URL", async () => {
      const asked: unknown[] = [];
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>({
          createUpload: async (input) => {
            asked.push(input);
            return {
              objectId: "storedobject_a",
              uploadUrl: "https://bucket.example/put?sig=1",
              method: "PUT" as const,
              headers: { "content-type": "image/png" },
              expiresAt: "2026-11-25T00:15:00.000Z",
            };
          },
        }),
      });

      const upload = await service.createUpload({
        projectId: PROJECT,
        filename: "shot.png",
        mediaType: "image/png",
        byteLength: MIB,
      });

      expect(asked).toEqual([
        expect.objectContaining({
          purpose: "langy_attachment",
          byteLength: MIB,
          filename: "shot.png",
        }),
      ]);
      expect(upload).toEqual({
        objectId: "storedobject_a",
        uploadUrl: "https://bucket.example/put?sig=1",
        method: "PUT",
        headers: { "content-type": "image/png" },
      });
    });

    /** @scenario A file that is not an image is refused before it uploads */
    it("refuses a PDF with langy_attachment_refused and creates no stored object", async () => {
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>(),
      });

      const error = await service
        .createUpload({
          projectId: PROJECT,
          filename: "report.pdf",
          mediaType: "application/pdf",
          byteLength: 10,
        })
        .catch((caught: unknown) => caught);

      expect(refusalOf(error)).toEqual({
        code: "langy_attachment_refused",
        reason: "not_an_image",
      });
    });

    /** @scenario An image over the size limit is refused before it uploads */
    it("refuses a PNG over 5 MiB with langy_attachment_refused and creates no stored object", async () => {
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>(),
      });

      const error = await service
        .createUpload({
          projectId: PROJECT,
          filename: "huge.png",
          mediaType: "image/png",
          byteLength: 5 * MIB + 1,
        })
        .catch((caught: unknown) => caught);

      expect(refusalOf(error)).toEqual({ code: "langy_attachment_refused", reason: "too_large" });
    });
  });

  describe("given a turn whose user message holds a confirmed langy_attachment image", () => {
    /** @scenario The image's bytes reach the worker as image input when the turn is dispatched */
    it("dispatches the image's media type, name and base64 bytes", async () => {
      const worker = new RecordingWorker();
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>({
          getMetadata: async () => metadataOf(),
          getById: async () => ({ metadata: metadataOf(), bytes: bytesOf(PNG_BYTES) }),
        }),
      });

      await service.withImages(worker).dispatch(dispatchInput([ref]));

      expect(worker.dispatched).toHaveLength(1);
      expect(worker.dispatched[0]?.images).toEqual([
        {
          name: "pasted-1a2b3c.png",
          mediaType: "image/png",
          data: Buffer.from(PNG_BYTES).toString("base64"),
        },
      ]);
      expect(worker.dispatched[0]).not.toHaveProperty("imageRefs");
    });
  });

  describe("given an upload whose bytes are not the image it claims to be", () => {
    /** @scenario A file whose bytes are not the image it claims is refused when it is confirmed */
    it("refuses the confirmation with langy_attachment_refused naming not_an_image", async () => {
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>({
          confirmUpload: async () => referenceOf(),
          getById: async () => ({
            metadata: metadataOf(),
            bytes: bytesOf(new TextEncoder().encode("hello, not a png")),
          }),
        }),
      });

      const error = await service
        .confirmUpload({ projectId: PROJECT, objectId: "storedobject_a" })
        .catch((caught: unknown) => caught);

      expect(refusalOf(error)).toEqual({
        code: "langy_attachment_refused",
        reason: "not_an_image",
      });
    });

    /** @scenario A file whose bytes are not the image it claims is refused when it is confirmed */
    it("confirms a PNG whose bytes are a PNG", async () => {
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>({
          confirmUpload: async () => referenceOf(),
          getById: async () => ({ metadata: metadataOf(), bytes: bytesOf(PNG_BYTES) }),
        }),
      });

      const attachment = await service.confirmUpload({
        projectId: PROJECT,
        objectId: "storedobject_a",
      });

      expect(attachment.url).toBe("/api/files/project_1/storedobject_a/pasted-1a2b3c.png");
    });

    /** @scenario A file whose bytes are not the image it claims is refused when it is confirmed */
    it("leaves an image whose stored bytes are not its type out of the dispatch", async () => {
      const worker = new RecordingWorker();
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>({
          getMetadata: async () => metadataOf(),
          getById: async () => ({
            metadata: metadataOf(),
            bytes: bytesOf(new TextEncoder().encode("GIF89a, not a png")),
          }),
        }),
      });

      await service.withImages(worker).dispatch(dispatchInput([ref]));

      expect(worker.dispatched[0]?.images).toBeUndefined();
    });
  });

  describe("given a user message whose file part names a stored object of another project or purpose", () => {
    /** @scenario An image from another project or purpose is never read for a turn */
    it.each([
      ["another purpose", async () => metadataOf({ purpose: "dataset_attachment" })],
      ["another project", async () => metadataOf({ projectId: "project_2" })],
      [
        "no such object",
        async (): Promise<StoredObjectMetadata> => {
          throw new StoredObjectNotFoundError();
        },
      ],
    ])("leaves the image of %s out and keeps the text", async (_name, getMetadata) => {
      const worker = new RecordingWorker();
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>({ getMetadata }),
      });

      await service.withImages(worker).dispatch(dispatchInput([ref]));

      expect(worker.dispatched[0]?.images).toBeUndefined();
      expect(worker.dispatched[0]?.prompt).toBe("what is in [▣ pasted-1a2b3c.png]?");
    });

    it("never names a file part whose address is another project's", async () => {
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>(),
      });

      const refs = await service.assertSendable({
        projectId: PROJECT,
        parts: [
          { type: "text", text: "hi" },
          {
            type: "file",
            mediaType: "image/png",
            filename: "x.png",
            url: "/api/files/project_2/storedobject_a/x.png",
          },
        ],
      });

      expect(refs).toEqual([]);
    });
  });

  describe("given a user message with five images", () => {
    /** @scenario A message with more images than allowed is refused */
    it("refuses the turn with langy_attachment_refused naming too many", async () => {
      const service = LangyAttachmentService.create({
        storedObjects: createApiFixture<StoredObjectApi>({
          getMetadata: async () => metadataOf(),
        }),
      });
      const parts = Array.from({ length: 5 }, (_unused, index) => ({
        type: "file",
        mediaType: "image/png",
        filename: `${index}.png`,
        url: `/api/files/${PROJECT}/storedobject_${index}/${index}.png`,
      }));

      const error = await service
        .assertSendable({ projectId: PROJECT, parts })
        .catch((caught: unknown) => caught);

      expect(refusalOf(error)).toEqual({ code: "langy_attachment_refused", reason: "too_many" });
    });
  });
});
