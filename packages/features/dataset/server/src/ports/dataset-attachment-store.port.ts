/**
 * Where the bytes a person uploaded into a dataset cell are kept.
 *
 * One method, because that is the whole of what the upload path asks of the
 * object store: hand it bytes and a purpose, get back the id the cell's
 * reference points at. The store itself is `@langwatch/stored-object-server`'s
 * content-addressed `StoredObjectsService`, which satisfies this. A feature
 * server package may not reach into another feature's server package, so the
 * process joins the two.
 *
 * `isDuplicate` is reported because the store deduplicates by content: the
 * same picture uploaded into two cells is kept once and both cells point at
 * the same id.
 */
export abstract class DatasetAttachmentStorePort {
  abstract storeFromBytes(input: {
    projectId: string;
    purpose: string;
    ownerKind: string;
    ownerId: string;
    mediaType: string;
    bytes: Buffer;
  }): Promise<{ id: string; mediaType: string; isDuplicate: boolean }>;
}
