import type { RetentionScopeGroup } from "./retention-grouping.ts";

/**
 * Query input and enable flag for the removal-preview dialog, which shows
 * fallback categories from the server.
 */
export function retentionRemovalPreviewQuery(
  projectId: string,
  target: RetentionScopeGroup | null,
) {
  return {
    input: {
      projectId,
      scope: target
        ? { scopeType: target.scopeType, scopeId: target.scopeId }
        : { scopeType: "PROJECT" as const, scopeId: "" },
    },
    options: { enabled: target !== null },
  };
}
