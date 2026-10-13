import { organizationDatasetAttachmentMaxMbSchema } from "@langwatch/ops-contract";

/**
 * Whether an organization write may go ahead as far as its per-file dataset
 * limit goes: it leaves the limit alone, clears it, or sets a whole number of
 * megabytes inside the allowed range.
 */
export function isOrganizationDatasetLimitWriteAllowed(
  data: Record<string, unknown> | undefined | null,
): boolean {
  if (!data || !("datasetAttachmentMaxMb" in data)) return true;

  return organizationDatasetAttachmentMaxMbSchema.validate(data.datasetAttachmentMaxMb);
}
