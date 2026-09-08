/**
 * The run loop's attachment read, over the stored-object service this process
 * composed. It carries the purpose and the project, so a reference naming any
 * other object reads as nothing at all.
 */
import { DATASET_ATTACHMENT_PURPOSE } from "@langwatch/dataset-contract";
import { ExperimentAttachmentPort } from "@langwatch/experiment-server";
import { createLogger } from "@langwatch/observability";
import type { StoredObjectsService } from "@langwatch/stored-object-server";
import { Readable } from "node:stream";

const logger = createLogger("langwatch:api:experiment");

/** The read half of the object store, which is all a run needs of it. */
/** @see specs/experiments-v3/dataset-attachments.feature */
export type ApiExperimentAttachmentObjectReader = Pick<StoredObjectsService, "tryGetById">;

export class ApiExperimentAttachmentAdapter extends ExperimentAttachmentPort {
  static create(options: {
    /**
     * Resolved per read: composing the run loop must not force the object store
     * to be built, and a deployment that composed none answers `undefined`.
     */
    storedObjects: () => ApiExperimentAttachmentObjectReader | undefined;
  }): ApiExperimentAttachmentAdapter {
    return new ApiExperimentAttachmentAdapter(options.storedObjects);
  }

  private reportedAbsence = false;

  private constructor(
    private readonly storedObjects: () => ApiExperimentAttachmentObjectReader | undefined,
  ) {
    super();
  }

  async tryRead({
    projectId,
    id,
  }: {
    projectId: string;
    id: string;
  }): Promise<{ bytes: Buffer; mediaType: string } | null> {
    const store = this.resolveStore();
    if (!store) {
      return null;
    }

    const result = await store.tryGetById({ projectId, id });
    if (!result || !("stream" in result)) {
      return null;
    }

    const row = result.row;
    // The purpose is what separates an object a user uploaded into a cell from
    // the trace media, spooled payloads and avatars sharing the store.
    if (row.purpose !== DATASET_ATTACHMENT_PURPOSE || row.project_id !== projectId) {
      result.stream.destroy?.();

      return null;
    }

    return { bytes: await readAll(result.stream), mediaType: row.media_type };
  }

  /**
   * The store, or nothing where this deployment composed none. Said once per
   * process rather than per cell: a run whose attachments cannot be read still
   * runs, with each cell keeping the reference text it holds.
   */
  private resolveStore(): ApiExperimentAttachmentObjectReader | undefined {
    try {
      const store = this.storedObjects();
      if (store) {
        return store;
      }
    } catch {
      // A deployment with no byte backend answers a refusing stand-in here.
    }

    if (!this.reportedAbsence) {
      this.reportedAbsence = true;
      logger.warn(
        {},
        "Uploaded dataset attachments are not inlined: this deployment composed no object store",
      );
    }

    return undefined;
  }
}

/** The whole object, which is what a data URL needs. */
async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }

  return Buffer.concat(chunks);
}
