/**
 * Files written into a row as base64 data URLs, stored beside the row: the
 * cell keeps the same reference an uploaded attachment leaves.
 * @see specs/datasets/dataset-attachments.feature
 */
import {
  DatasetAttachmentTypeRefusedError,
  DatasetInlineFileUnreadableError,
  type DatasetColumns,
} from "@langwatch/dataset-contract";

import { assertDatasetAttachmentWithinLimit } from "../rules/dataset-attachment.rules.ts";
import {
  decodeInlineFile,
  inlineFileNameOf,
  isInlineFileValue,
  readInlineFile,
} from "../rules/dataset-inline-file.rules.ts";
import type { DatasetAttachmentUploadService } from "./dataset-attachment-upload.service.ts";

type AttachmentColumnType = "image" | "file";

/**
 * Which cells are read for inline files. A dataset with typed columns reads
 * its image and file columns. A file imported with no column types reads every
 * column for inline pictures, and reports the columns that held one.
 */
type InlineAttachmentColumns =
  | { kind: "typed"; columnTypes: DatasetColumns }
  | { kind: "untyped"; onPictureColumn: (column: string) => void };

export type InlineAttachmentScope = {
  projectId: string;
  datasetId?: string;
  columns: InlineAttachmentColumns;
  /** The per-file limit the organization answers; resolved once for the whole write. */
  maxBytes: () => Promise<number>;
};

const DEFAULT_MEDIA_TYPE = "application/octet-stream";

export class DatasetInlineAttachmentService {
  static create(deps: {
    uploads: Pick<DatasetAttachmentUploadService, "storeBytes">;
  }): DatasetInlineAttachmentService {
    return new DatasetInlineAttachmentService(deps.uploads);
  }

  private constructor(
    private readonly uploads: Pick<DatasetAttachmentUploadService, "storeBytes">,
  ) {}

  /**
   * One row with each inline file stored and replaced by its reference. The
   * row is returned as it came when it holds none, and one file is in memory
   * at a time.
   */
  async store<Entry extends Record<string, unknown>>(
    scope: InlineAttachmentScope,
    entry: Entry,
  ): Promise<Entry> {
    let stored: Record<string, unknown> | undefined;
    for (const [column, value] of Object.entries(entry)) {
      if (!isInlineFileValue(value)) continue;
      const columnType = attachmentColumnOf(scope.columns, column, value);
      if (columnType === "none") continue;

      stored ??= { ...entry };
      stored[column] = await this.storeCell({ scope, column, columnType, value });
      if (scope.columns.kind === "untyped") scope.columns.onPictureColumn(column);
    }

    return (stored as Entry | undefined) ?? entry;
  }

  /** Several rows, one after the other, so one file is in memory at a time. */
  async storeAll<Entry extends Record<string, unknown>>(
    scope: InlineAttachmentScope,
    entries: readonly Entry[],
  ): Promise<Entry[]> {
    const stored: Entry[] = [];
    for (const entry of entries) stored.push(await this.store(scope, entry));

    return stored;
  }

  private async storeCell(input: {
    scope: InlineAttachmentScope;
    column: string;
    columnType: AttachmentColumnType;
    value: string;
  }): Promise<string> {
    const { scope, column, columnType, value } = input;
    const file = readInlineFile(value);
    if (file.kind === "unreadable") throw new DatasetInlineFileUnreadableError(column);

    const mediaType = file.mediaType || DEFAULT_MEDIA_TYPE;
    if (columnType === "image" && !mediaType.startsWith("image/")) {
      throw new DatasetAttachmentTypeRefusedError(mediaType);
    }
    // The size is known from the length alone, so an oversized file is never decoded.
    const maxBytes = await scope.maxBytes();
    assertDatasetAttachmentWithinLimit(file.byteLength, maxBytes);

    const bytes = decodeInlineFile(value, file);
    if (!bytes) throw new DatasetInlineFileUnreadableError(column);

    const attachment = await this.uploads.storeBytes({
      projectId: scope.projectId,
      datasetId: scope.datasetId,
      filename: inlineFileNameOf(column, mediaType),
      mediaType,
      bytes,
      byteLength: bytes.byteLength,
      maxBytes,
    });

    return attachment.url;
  }
}

/** Which kind of attachment column a cell sits in; "none" for a cell that is not read for files. */
function attachmentColumnOf(
  columns: InlineAttachmentColumns,
  column: string,
  value: string,
): AttachmentColumnType | "none" {
  if (columns.kind === "untyped") return value.startsWith("data:image/") ? "image" : "none";

  const type = columns.columnTypes.find((candidate) => candidate.name === column)?.type;

  return type === "image" || type === "file" ? type : "none";
}
