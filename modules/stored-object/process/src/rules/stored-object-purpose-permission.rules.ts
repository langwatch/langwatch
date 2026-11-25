/**
 * Which permission guards a stored object, by what the object IS: trace media,
 * dataset files and scenario media are separate categories a custom role
 * holds independently. @see specs/datasets/dataset-attachments.feature
 */
import {
  purposePolicyOf,
  type StoredObjectFileViewPermission,
} from "@langwatch/stored-object-contract";

export function requiredPermissionForPurpose(purpose: string): StoredObjectFileViewPermission {
  return purposePolicyOf(purpose).readPermission;
}
