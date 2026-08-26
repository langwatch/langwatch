import type { RetentionScopeGroup } from "@langwatch/data-retention-web";

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
