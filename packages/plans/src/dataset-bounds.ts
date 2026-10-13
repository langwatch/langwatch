/**
 * Every dataset size limit, derived from the largest file an image or file cell
 * accepts and how many such files one row is sized for. An organization whose
 * per-file limit was raised gets the same derivation over its own number.
 */

const MiB = 1024 * 1024;

/** The largest file an image or file cell accepts when the organization sets nothing. */
export const DATASET_ATTACHMENT_DEFAULT_MAX_BYTES = 20 * MiB;

/** The highest per-file limit an organization can be raised to. */
export const DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES = 1024 * MiB;

/** How many files of the per-file limit one row is sized to carry inline. */
export const DATASET_ATTACHMENTS_PER_ROW = 10;

/**
 * One row is read as one string, and V8 refuses a string above about 512 MiB,
 * so no inline limit goes past this whatever the per-file limit is.
 */
export const DATASET_INLINE_STRING_CEILING_BYTES = 480 * MiB;

/** How many rows of the row limit one upload call is sized to carry. */
const FULL_ROWS_PER_UPLOAD = 4;

/** The bounds that follow the per-file limit. Each is also a request-bounds registry key. */
export const DATASET_DERIVED_BOUND_KEYS = [
  "datasetAttachmentBytes",
  "datasetRowBytes",
  "datasetFileBytes",
  "datasetJsonFileBytes",
  "datasetInlineReadBytes",
  "datasetWholeReadBytes",
  "evaluationLogResultsBytes",
] as const;
export type DatasetDerivedBoundKey = (typeof DATASET_DERIVED_BOUND_KEYS)[number];

export type DatasetDerivedBounds = Readonly<Record<DatasetDerivedBoundKey, number>>;

/** The length of `byteLength` bytes once written as base64, the form an inline image takes. */
export function base64LengthOf(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

/**
 * The per-file limit an organization answers: its own number when one is set
 * and larger than the default, never above the ceiling, never below the default.
 */
export function effectiveDatasetAttachmentMaxBytes(override: number | null | undefined): number {
  if (override === null || override === undefined || !Number.isFinite(override)) {
    return DATASET_ATTACHMENT_DEFAULT_MAX_BYTES;
  }

  return Math.min(
    Math.max(Math.floor(override), DATASET_ATTACHMENT_DEFAULT_MAX_BYTES),
    DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
  );
}

/** Every derived bound for one per-file limit. */
export function deriveDatasetBounds(attachmentMaxBytes: number): DatasetDerivedBounds {
  const inlineFileBytes = base64LengthOf(attachmentMaxBytes);
  // One row with every image inline, plus room for its other cells.
  const datasetRowBytes = Math.min(
    DATASET_ATTACHMENTS_PER_ROW * inlineFileBytes + MiB,
    DATASET_INLINE_STRING_CEILING_BYTES,
  );
  const datasetFileBytes = FULL_ROWS_PER_UPLOAD * datasetRowBytes;

  return {
    datasetAttachmentBytes: attachmentMaxBytes,
    datasetRowBytes,
    datasetFileBytes,
    // A `.json` array is parsed from one string; JSONL and CSV stream row by row.
    datasetJsonFileBytes: Math.min(datasetFileBytes, DATASET_INLINE_STRING_CEILING_BYTES),
    // An answer that carries rows inline always fits one row holding one inline file.
    datasetInlineReadBytes: Math.min(inlineFileBytes + MiB, DATASET_INLINE_STRING_CEILING_BYTES),
    // A read that holds the whole dataset in memory always fits one full row.
    datasetWholeReadBytes: datasetRowBytes,
    // One logged batch always fits one full row.
    evaluationLogResultsBytes: datasetRowBytes,
  };
}

/** The derived bounds every organization answers until its per-file limit is raised. */
export const DATASET_DEFAULT_BOUNDS: DatasetDerivedBounds = deriveDatasetBounds(
  DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
);

export function isDatasetDerivedBoundKey(key: string): key is DatasetDerivedBoundKey {
  return (DATASET_DERIVED_BOUND_KEYS as readonly string[]).includes(key);
}
