/**
 * What each stored-object purpose allows: whether a caller may upload it, its
 * byte limit, and the permission its files are read behind (ADR-158 §3, §5).
 */
import {
  DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
  DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
  resolveRequestBound,
} from "@langwatch/plans";

const MIB = 1024 * 1024;

/** The purpose that marks a file as a dataset cell attachment. */
export const DATASET_ATTACHMENT_PURPOSE = "dataset_attachment";

/** The purpose that marks a file as the source of a dataset import. */
export const DATASET_IMPORT_PURPOSE = "dataset_import";

/** The permissions a stored file is read behind, one per category of what it is. */
export const FILE_VIEW_PERMISSIONS = ["traces:view", "scenarios:view", "datasets:view"] as const;
export type StoredObjectFileViewPermission = (typeof FILE_VIEW_PERMISSIONS)[number];

export interface StoredObjectPurposePolicy {
  readonly uploadable: boolean;
  /** The byte limit a caller is held to when the owning module names none. */
  readonly maxBytes: number;
  /**
   * The highest limit the owning module may name for one caller. Absent, the
   * purpose has one limit for everyone.
   */
  readonly ceilingBytes?: number;
  readonly readPermission: StoredObjectFileViewPermission;
}

/** The dataset attachment limit an organization answers when it sets nothing. */
export const DATASET_ATTACHMENT_PURPOSE_DEFAULT_BYTES = DATASET_ATTACHMENT_DEFAULT_MAX_BYTES;

/** The highest dataset attachment limit an organization can be raised to. */
export const DATASET_ATTACHMENT_PURPOSE_CEILING_BYTES = DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES;

/** How many uploads one caller may start in a minute. */
export const STORED_OBJECT_UPLOADS_PER_MINUTE = resolveRequestBound(
  "datasetAttachmentUploadsPerMinute",
  "FREE",
);

export const STORED_OBJECT_PURPOSES: Readonly<Record<string, StoredObjectPurposePolicy>> = {
  [DATASET_ATTACHMENT_PURPOSE]: {
    uploadable: true,
    maxBytes: DATASET_ATTACHMENT_PURPOSE_DEFAULT_BYTES,
    ceilingBytes: DATASET_ATTACHMENT_PURPOSE_CEILING_BYTES,
    readPermission: "datasets:view",
  },
  [DATASET_IMPORT_PURPOSE]: {
    uploadable: true,
    maxBytes: 5 * 1024 * MIB,
    readPermission: "datasets:view",
  },
  trace_content: { uploadable: false, maxBytes: 100 * MIB, readPermission: "traces:view" },
  scenario_event: { uploadable: false, maxBytes: 100 * MIB, readPermission: "scenarios:view" },
};

/** Every purpose the table does not name: written in process only, read as scenario media. */
export const UNLISTED_PURPOSE_POLICY: StoredObjectPurposePolicy = {
  uploadable: false,
  maxBytes: 100 * MIB,
  readPermission: "scenarios:view",
};

export function purposePolicyOf(purpose: string): StoredObjectPurposePolicy {
  return Object.hasOwn(STORED_OBJECT_PURPOSES, purpose)
    ? (STORED_OBJECT_PURPOSES[purpose] ?? UNLISTED_PURPOSE_POLICY)
    : UNLISTED_PURPOSE_POLICY;
}

/**
 * The byte limit one upload is held to: the purpose's own, or the one the
 * owning module named for this caller, never above the purpose's ceiling.
 */
export function purposeByteLimitOf(
  policy: StoredObjectPurposePolicy,
  callerMaxBytes: number | undefined,
): number {
  if (callerMaxBytes === undefined) return policy.maxBytes;
  return Math.min(Math.max(callerMaxBytes, 0), policy.ceilingBytes ?? policy.maxBytes);
}
