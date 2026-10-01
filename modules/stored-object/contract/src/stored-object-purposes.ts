/**
 * What each stored-object purpose allows: whether a caller may upload it, its
 * byte limit, and the permission its files are read behind (ADR-158 §3, §5).
 */

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
  readonly maxBytes: number;
  readonly readPermission: StoredObjectFileViewPermission;
}

export const STORED_OBJECT_PURPOSES: Readonly<Record<string, StoredObjectPurposePolicy>> = {
  [DATASET_ATTACHMENT_PURPOSE]: {
    uploadable: true,
    maxBytes: 20 * MIB,
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
