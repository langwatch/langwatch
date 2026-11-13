import {
  auditStaffAccessMetadataSchema,
  type AuditStaffAccess,
} from "@langwatch/organization-contract";

/**
 * The staff access an audit row records (ADR-202): the gate's own `staffAccess.*` rows hold it as
 * their metadata, and a change made with a staff key carries `staffPrincipal` and `staffReason`.
 */
export function extractAuditStaffAccess({
  action,
  metadata,
}: {
  action: string;
  metadata: unknown;
}): AuditStaffAccess | undefined {
  if (action.startsWith("staffAccess.")) {
    return auditStaffAccessMetadataSchema.safeParse(metadata).data;
  }
  if (typeof metadata !== "object" || metadata === null) return undefined;

  const { staffPrincipal, staffReason } = metadata as Record<string, unknown>;
  if (typeof staffPrincipal !== "string" || staffPrincipal === "") return undefined;

  return {
    principal: staffPrincipal,
    reason: typeof staffReason === "string" ? staffReason : null,
  };
}
