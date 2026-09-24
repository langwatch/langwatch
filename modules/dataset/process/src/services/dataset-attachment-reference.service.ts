/** The stored-file references a record write brings in, checked before it lands (ADR-158 §6). */
import {
  DATASET_ATTACHMENT_MAX_BYTES,
  DatasetAttachmentReferenceRefusedError,
  DatasetAttachmentTooLargeError,
  DatasetAttachmentTypeRefusedError,
  datasetAttachmentAcceptance,
  parseDatasetAttachmentRef,
  type DatasetAttachmentRef,
  type DatasetColumns,
} from "@langwatch/dataset-contract";
import {
  StoredObjectNotFoundError,
  type StoredObjectApi,
  type StoredObjectMetadata,
} from "@langwatch/stored-object-contract";

type AttachmentCell = { column: string; columnType: "image" | "file"; value: string };

export class DatasetAttachmentReferenceService {
  static create(deps: { storedObjects: StoredObjectApi }): DatasetAttachmentReferenceService {
    return new DatasetAttachmentReferenceService(deps.storedObjects);
  }

  private constructor(private readonly storedObjects: StoredObjectApi) {}

  /** Refuses the first image or file cell whose new reference this dataset cannot hold. */
  async assertAccepted(input: {
    projectId: string;
    columnTypes: DatasetColumns;
    entries: readonly Record<string, unknown>[];
    findHeld?: () => Promise<readonly Record<string, unknown>[]>;
  }): Promise<void> {
    let held: Set<string> | undefined;
    const checked = new Set<string>();
    for (const cell of attachmentCells(input.columnTypes, input.entries)) {
      if (checked.has(cell.value)) continue;
      checked.add(cell.value);
      const ref = parseDatasetAttachmentRef(cell.value);
      if (!ref) continue;
      held ??= new Set(
        [...attachmentCells(input.columnTypes, (await input.findHeld?.()) ?? [])].map(
          (heldCell) => heldCell.value,
        ),
      );
      if (held.has(cell.value)) continue;
      await this.assertCellAccepted(input.projectId, cell, ref);
    }
  }

  private async assertCellAccepted(
    projectId: string,
    cell: AttachmentCell,
    ref: DatasetAttachmentRef,
  ): Promise<void> {
    const refused = (reason: "not_found" | "not_confirmed" | "wrong_purpose") =>
      new DatasetAttachmentReferenceRefusedError({ reason, column: cell.column });
    if (ref.projectId !== projectId) throw refused("not_found");

    const metadata = await this.getMetadata(projectId, ref.objectId, cell.column);
    if (metadata.projectId !== projectId) throw refused("not_found");
    if (metadata.status !== "available") throw refused("not_confirmed");

    const verdict = datasetAttachmentAcceptance({
      columnType: cell.columnType,
      purpose: metadata.provenance.purpose,
      mediaType: metadata.mediaType,
      byteLength: metadata.byteLength,
    });
    if (verdict.accepted) return;
    if (verdict.refusal === "wrong_purpose") throw refused("wrong_purpose");
    if (verdict.refusal === "type_refused") {
      throw new DatasetAttachmentTypeRefusedError(metadata.mediaType);
    }
    throw new DatasetAttachmentTooLargeError(DATASET_ATTACHMENT_MAX_BYTES);
  }

  private async getMetadata(
    projectId: string,
    id: string,
    column: string,
  ): Promise<StoredObjectMetadata> {
    try {
      return await this.storedObjects.getMetadata({ projectId, id });
    } catch (error) {
      if (!(error instanceof StoredObjectNotFoundError)) throw error;
      throw new DatasetAttachmentReferenceRefusedError({ reason: "not_found", column });
    }
  }
}

function* attachmentCells(
  columnTypes: DatasetColumns,
  entries: readonly Record<string, unknown>[],
): Generator<AttachmentCell> {
  const columns = columnTypes.filter(
    (column): column is { name: string; type: "image" | "file" } =>
      column.type === "image" || column.type === "file",
  );
  for (const entry of entries) {
    for (const column of columns) {
      const value = entry[column.name];
      if (typeof value !== "string") continue;
      yield { column: column.name, columnType: column.type, value: value.trim() };
    }
  }
}
