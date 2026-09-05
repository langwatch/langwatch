import type { ExecutionScope } from "@langwatch/experiment-contract";
import type { RunPayload } from "./schemas";

/**
 * Map a `workbench.run` payload onto an ExecutionScope.
 */
export function scopeFromRunPayload(payload: RunPayload): ExecutionScope {
  const targetIds = payload.targetIds ?? [];
  const rowIndices = payload.rowIndices ?? [];

  if (targetIds.length > 0 && rowIndices.length > 0) {
    return { type: "target-rows", targetIds, rowIndices };
  }
  if (targetIds.length === 1 && targetIds[0]) {
    return { type: "target", targetId: targetIds[0] };
  }
  if (targetIds.length > 1) {
    return { type: "target-rows", targetIds };
  }
  if (rowIndices.length > 0) {
    return { type: "rows", rowIndices };
  }
  return { type: "full" };
}
