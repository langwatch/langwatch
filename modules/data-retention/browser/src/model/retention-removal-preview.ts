import type { RetentionScopeGroup } from "./retention-grouping.ts";

/**
 * Query input and enable flag for the removal-preview dialog, which shows
 * fallback categories from the server. A page outside an organization asks nothing.
 */
export function retentionRemovalPreviewQuery({
  projectId,
  organizationId,
  target,
}: {
  projectId: string;
  organizationId: string | undefined;
  target: RetentionScopeGroup | null;
}) {
  return {
    input: {
      projectId,
      organizationId: organizationId ?? "",
      scope: target
        ? { scopeType: target.scopeType, scopeId: target.scopeId }
        : { scopeType: "PROJECT" as const, scopeId: "" },
    },
    options: { enabled: target !== null && organizationId !== undefined },
  };
}
