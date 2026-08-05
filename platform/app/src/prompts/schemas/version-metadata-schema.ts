import { z } from "zod";

/**
 * Shared version metadata schema for tracking database-sourced prompts
 * Used across form values and node data for consistency
 * Note: configId is stored separately at the root level, not in metadata
 *
 * Single Responsibility: Define and validate version tracking metadata structure
 */
export const versionMetadataSchema = z.object({
  /** Database ID of the specific version */
  versionId: z.string(),
  /** Version number (incremental) */
  versionNumber: z.number(),
  /** When this version was created (Date in forms, ISO string in node data) */
  versionCreatedAt: z.union([z.date(), z.string()]),
});

export type VersionMetadata = z.infer<typeof versionMetadataSchema>;

/**
 * Converts version metadata from form format (Date) to node format (ISO string)
 *
 * Single Responsibility: Normalize versionCreatedAt field for node data storage
 */
export function versionMetadataToNodeFormat(
  metadata: VersionMetadata | undefined,
):
  | {
      versionId: string;
      versionNumber: number;
      versionCreatedAt: string;
    }
  | undefined {
  if (!metadata) return undefined;

  return {
    versionId: metadata.versionId,
    versionNumber: metadata.versionNumber,
    versionCreatedAt:
      metadata.versionCreatedAt instanceof Date
        ? metadata.versionCreatedAt.toISOString()
        : metadata.versionCreatedAt,
  };
}

/**
 * Converts version metadata from node format (ISO string) to form format (Date)
 *
 * Single Responsibility: Normalize versionCreatedAt field for form state
 */
export function versionMetadataToFormFormat(
  metadata:
    | {
        versionId: string;
        versionNumber: number;
        versionCreatedAt: string | Date;
      }
    | undefined,
): VersionMetadata | undefined {
  if (!metadata) return undefined;

  return {
    versionId: metadata.versionId,
    versionNumber: metadata.versionNumber,
    versionCreatedAt:
      typeof metadata.versionCreatedAt === "string"
        ? new Date(metadata.versionCreatedAt)
        : metadata.versionCreatedAt,
  };
}
