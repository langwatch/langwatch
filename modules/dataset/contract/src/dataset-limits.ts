/**
 * The dataset size limits one organization answers, and how a limit reads in
 * copy. Browser safe, so the upload drawer and the server quote one number.
 * @see specs/datasets/dataset-limits.feature
 */
import {
  DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
  deriveDatasetBounds,
  resolveRequestBound,
} from "@langwatch/plans";
import { z } from "zod";

export const datasetLimitsSchema = z
  .object({
    /** The largest file an image or file cell accepts. */
    attachmentBytes: z.number().int().positive(),
    /** One row of an uploaded file, with its files inline. */
    rowBytes: z.number().int().positive(),
    /** One uploaded file. */
    fileBytes: z.number().int().positive(),
    /** One `.json` array file, which is read whole. */
    jsonFileBytes: z.number().int().positive(),
    /** The rows one response carries inline. */
    inlineReadBytes: z.number().int().positive(),
    /** A read that holds a whole dataset in memory. */
    wholeReadBytes: z.number().int().positive(),
    /** The rows one upload carries. */
    rowsMax: z.number().int().positive(),
  })
  .strict();
export type DatasetLimits = z.infer<typeof datasetLimitsSchema>;

/** The request-bounds registry key each limit is resolved from. */
export const DATASET_LIMIT_BOUND_KEYS = {
  attachmentBytes: "datasetAttachmentBytes",
  rowBytes: "datasetRowBytes",
  fileBytes: "datasetFileBytes",
  jsonFileBytes: "datasetJsonFileBytes",
  inlineReadBytes: "datasetInlineReadBytes",
  wholeReadBytes: "datasetWholeReadBytes",
  rowsMax: "datasetRowsMax",
} as const satisfies Record<keyof DatasetLimits, string>;

/** The limits every organization answers until its per-file limit is raised. */
export const DATASET_DEFAULT_LIMITS: DatasetLimits = {
  attachmentBytes: resolveRequestBound("datasetAttachmentBytes", "FREE"),
  rowBytes: resolveRequestBound("datasetRowBytes", "FREE"),
  fileBytes: resolveRequestBound("datasetFileBytes", "FREE"),
  jsonFileBytes: resolveRequestBound("datasetJsonFileBytes", "FREE"),
  inlineReadBytes: resolveRequestBound("datasetInlineReadBytes", "FREE"),
  wholeReadBytes: resolveRequestBound("datasetWholeReadBytes", "FREE"),
  rowsMax: resolveRequestBound("datasetRowsMax", "FREE"),
};

const CEILING_BOUNDS = deriveDatasetBounds(DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES);

/**
 * The highest value each limit can reach for any organization. A declaration
 * with no project in reach (a multipart body cap) uses these, and the service
 * then holds the request to the organization's own limit.
 */
export const DATASET_CEILING_LIMITS: DatasetLimits = {
  attachmentBytes: CEILING_BOUNDS.datasetAttachmentBytes,
  rowBytes: CEILING_BOUNDS.datasetRowBytes,
  fileBytes: CEILING_BOUNDS.datasetFileBytes,
  jsonFileBytes: CEILING_BOUNDS.datasetJsonFileBytes,
  inlineReadBytes: CEILING_BOUNDS.datasetInlineReadBytes,
  wholeReadBytes: CEILING_BOUNDS.datasetWholeReadBytes,
  rowsMax: DATASET_DEFAULT_LIMITS.rowsMax,
};

const KIB = 1024;
const MIB = 1024 * KIB;
const GIB = 1024 * MIB;

/**
 * A byte limit in the plain unit a person reads, rounded down so a file of the
 * quoted size always fits: "20 MB", "267 MB", "1 GB".
 */
export function formatDatasetByteLimit(bytes: number): string {
  if (bytes >= GIB) return `${trimmed(Math.floor((bytes / GIB) * 10) / 10)} GB`;
  if (bytes >= MIB) return `${Math.floor(bytes / MIB)} MB`;
  if (bytes >= KIB) return `${Math.floor(bytes / KIB)} KB`;
  return `${bytes} bytes`;
}

function trimmed(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

const rowCountFormatter = new Intl.NumberFormat("en-US");

/** A row limit with a fixed thousands separator: "100,000". */
export function formatDatasetRowLimit(rows: number): string {
  return rowCountFormatter.format(rows);
}
