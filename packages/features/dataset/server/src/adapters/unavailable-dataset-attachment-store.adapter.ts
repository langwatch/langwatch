/**
 * The attachment store on a deployment that composed no object storage.
 *
 * The upload procedure still mounts, so the editor gets one clear refusal it
 * can put words to, instead of a namespace that is missing on some
 * deployments and present on others.
 */
import { DatasetAttachmentStorageUnavailableError } from "@langwatch/dataset-contract";

import { DatasetAttachmentStorePort } from "../ports/dataset-attachment-store.port.ts";

export class UnavailableDatasetAttachmentStore extends DatasetAttachmentStorePort {
  static create(): UnavailableDatasetAttachmentStore {
    return new UnavailableDatasetAttachmentStore();
  }

  storeFromBytes(): Promise<{ id: string; mediaType: string; isDuplicate: boolean }> {
    return Promise.reject(new DatasetAttachmentStorageUnavailableError());
  }
}
