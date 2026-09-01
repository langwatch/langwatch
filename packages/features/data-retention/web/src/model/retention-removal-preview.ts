import type { RetentionScopeGroup } from "./retention-grouping";

/**
 * The input and the enable flag for the remove-confirmation preview read.
 *
 * The dialog shows what each category would fall back to once the scope's
 * override is gone, and the answer comes from the server rather than from a
 * guess. Nothing is asked until a group is actually pending removal, which is
 * what `enabled` says; the placeholder input exists because the hook's input
 * type has no absent case and an empty scope id is never dispatched.
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
