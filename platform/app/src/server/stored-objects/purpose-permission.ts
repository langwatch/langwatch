/**
 * Which permission guards a stored object.
 *
 * Stored objects are shared by several features, and which permission guards a
 * read depends on what the object IS: trace media requires `traces:view`,
 * scenario media requires `scenarios:view`, and a file attached to a dataset
 * cell requires `datasets:view`. They are separate permission categories, and a
 * custom role can hold one without the others.
 *
 * The read route and the existence probe both read the mapping from here, so a
 * caller can never probe an object it could not open.
 */
import { DATASET_ATTACHMENT_PURPOSE } from "~/server/datasets/attachments";

export const FILE_VIEW_PERMISSIONS = [
  "traces:view",
  "scenarios:view",
  "datasets:view",
] as const;

export type FileViewPermission = (typeof FILE_VIEW_PERMISSIONS)[number];

export function requiredPermissionForPurpose(
  purpose: string,
): FileViewPermission {
  if (purpose === "trace_content") return "traces:view";
  if (purpose === DATASET_ATTACHMENT_PURPOSE) return "datasets:view";
  return "scenarios:view";
}
