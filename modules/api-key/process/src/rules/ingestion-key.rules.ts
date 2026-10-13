import { INGESTION_PERMISSIONS, type ApiKeyRestCreate } from "@langwatch/api-key-contract";

/**
 * The one shape a person's project session may mint: personal, their own, one CUSTOM binding to
 * that project, holding exactly INGESTION_PERMISSIONS. Expiry is the caller's; none never expires.
 */
export function isIngestionShape({
  input,
  projectId,
  callerUserId,
}: {
  input: ApiKeyRestCreate;
  projectId: string;
  callerUserId: string;
}): boolean {
  const [binding, ...extra] = input.bindings ?? [];
  const permissions = [...(input.permissions ?? [])].toSorted();

  return (
    input.keyType === "personal" &&
    (input.assignedToUserId === undefined || input.assignedToUserId === callerUserId) &&
    (input.projectIds ?? []).length === 0 &&
    binding !== undefined &&
    extra.length === 0 &&
    binding.role === "CUSTOM" &&
    binding.scopeType === "PROJECT" &&
    binding.scopeId === projectId &&
    input.permissionMode === "restricted" &&
    permissions.join(",") === [...INGESTION_PERMISSIONS].toSorted().join(",")
  );
}
