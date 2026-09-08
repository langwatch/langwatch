/**
 * The bytes behind an attachment a dataset cell references, from an object store
 * this feature does not own. `null` for a row that is not this project's dataset
 * attachment, and for bytes the store no longer holds.
 */
export abstract class ExperimentAttachmentPort {
  abstract tryRead(input: {
    projectId: string;
    id: string;
  }): Promise<{ bytes: Buffer; mediaType: string } | null>;
}
