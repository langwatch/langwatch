import {
  LANGY_ATTACHMENT_MAX_BYTES,
  LANGY_ATTACHMENT_MAX_COUNT,
  type LangyAttachment,
  type LangyAttachmentConfirmInput,
  type LangyAttachmentRef,
  LangyAttachmentRefusedError,
  type LangyAttachmentUpload,
  type LangyAttachmentUploadInput,
  isLangyAttachmentMediaType,
  langyAttachmentRefsOf,
  langyAttachmentVerdictOf,
  langyAttachmentUrlOf,
} from "@langwatch/langy-contract";
import { createLogger } from "@langwatch/observability";
import {
  LANGY_ATTACHMENT_PURPOSE,
  type StoredObjectApi,
  type StoredObjectMetadata,
  StoredObjectNotFoundError,
} from "@langwatch/stored-object-contract";

import type {
  LangyWorker,
  LangyWorkerDispatchInput,
  LangyWorkerImage,
} from "../../../channels/langy-worker.channel.ts";

const logger = createLogger("langwatch:langy:attachments");

type StoredObjects = Pick<
  StoredObjectApi,
  "createUpload" | "confirmUpload" | "getMetadata" | "getById"
>;

/**
 * Images attached to a Langy message: the signed upload, the check at turn start, and the bytes
 * read back at dispatch so the model gets the image itself (ADR-158).
 * Spec: modules/langy/specs/langy-image-attachments.feature
 */
export class LangyAttachmentService {
  private constructor(private readonly storedObjects: StoredObjects) {}

  static create({ storedObjects }: { storedObjects: StoredObjects }): LangyAttachmentService {
    return new LangyAttachmentService(storedObjects);
  }

  async createUpload(input: LangyAttachmentUploadInput): Promise<LangyAttachmentUpload> {
    const verdict = langyAttachmentVerdictOf(input);
    if (verdict !== "accepted") throw new LangyAttachmentRefusedError(verdict);
    const upload = await this.storedObjects.createUpload({
      projectId: input.projectId,
      purpose: LANGY_ATTACHMENT_PURPOSE,
      filename: input.filename,
      mediaType: input.mediaType.toLowerCase(),
      byteLength: input.byteLength,
      maxBytes: LANGY_ATTACHMENT_MAX_BYTES,
    });
    return {
      objectId: upload.objectId,
      uploadUrl: upload.uploadUrl,
      method: upload.method,
      ...(upload.headers ? { headers: upload.headers } : {}),
    };
  }

  async confirmUpload(input: LangyAttachmentConfirmInput): Promise<LangyAttachment> {
    const reference = await this.storedObjects.confirmUpload({
      projectId: input.projectId,
      objectId: input.objectId,
    });
    return {
      objectId: reference.id,
      url: langyAttachmentUrlOf({
        projectId: input.projectId,
        objectId: reference.id,
        filename: reference.filename,
      }),
      filename: reference.filename,
      mediaType: reference.mediaType,
      byteLength: reference.byteLength,
    };
  }

  /** Refuses a message naming too many images, or one this project does not hold as Langy's. */
  async assertSendable({
    projectId,
    parts,
  }: {
    projectId: string;
    parts: readonly unknown[] | undefined;
  }): Promise<LangyAttachmentRef[]> {
    const refs = langyAttachmentRefsOf({ projectId, parts });
    if (refs.length > LANGY_ATTACHMENT_MAX_COUNT) {
      throw new LangyAttachmentRefusedError("too_many");
    }
    for (const ref of refs) {
      const [metadata] = await this.findLangyImage({ projectId, ref });
      if (!metadata) throw new LangyAttachmentRefusedError("not_found");
    }
    return refs;
  }

  /** The images a dispatch names, read back as bytes; one no longer readable is left out. */
  async loadImages({
    projectId,
    refs,
  }: {
    projectId: string;
    refs: readonly LangyAttachmentRef[];
  }): Promise<LangyWorkerImage[]> {
    const images: LangyWorkerImage[] = [];
    for (const ref of refs.slice(0, LANGY_ATTACHMENT_MAX_COUNT)) {
      const [metadata] = await this.findLangyImage({ projectId, ref });
      if (!metadata) {
        logger.warn({ projectId, objectId: ref.objectId }, "langy image left out of the turn");
        continue;
      }
      const read = await this.storedObjects.getById({ projectId, id: ref.objectId });
      const chunks: Uint8Array[] = [];
      for await (const chunk of read.bytes) chunks.push(chunk);
      images.push({
        name: ref.filename,
        mediaType: metadata.mediaType.toLowerCase(),
        data: Buffer.concat(chunks).toString("base64"),
      });
    }
    return images;
  }

  /** The worker channel with each dispatch's image references read into image input. */
  withImages(worker: LangyWorker): LangyWorker {
    return new LangyImageDispatchingWorker(worker, this);
  }

  private async findLangyImage({
    projectId,
    ref,
  }: {
    projectId: string;
    ref: LangyAttachmentRef;
  }): Promise<StoredObjectMetadata[]> {
    let metadata: StoredObjectMetadata;
    try {
      metadata = await this.storedObjects.getMetadata({ projectId, id: ref.objectId });
    } catch (error) {
      if (error instanceof StoredObjectNotFoundError) return [];
      throw error;
    }
    const usable =
      metadata.projectId === projectId &&
      metadata.status === "available" &&
      metadata.provenance.purpose === LANGY_ATTACHMENT_PURPOSE &&
      isLangyAttachmentMediaType(metadata.mediaType) &&
      metadata.byteLength <= LANGY_ATTACHMENT_MAX_BYTES;
    return usable ? [metadata] : [];
  }
}

/** Reads a dispatch's image references into bytes, then hands it on to the real channel. */
class LangyImageDispatchingWorker implements LangyWorker {
  constructor(
    private readonly inner: LangyWorker,
    private readonly attachments: LangyAttachmentService,
  ) {}

  probe(input: Parameters<LangyWorker["probe"]>[0]) {
    return this.inner.probe(input);
  }

  warm(input: Parameters<LangyWorker["warm"]>[0]) {
    return this.inner.warm(input);
  }

  cancel(input: Parameters<LangyWorker["cancel"]>[0]) {
    return this.inner.cancel(input);
  }

  async dispatch({ imageRefs, ...input }: LangyWorkerDispatchInput) {
    if (!imageRefs?.length) return this.inner.dispatch(input);
    const images = await this.attachments.loadImages({
      projectId: input.projectId,
      refs: imageRefs,
    });
    return this.inner.dispatch({ ...input, ...(images.length > 0 ? { images } : {}) });
  }
}
