import type { ExecutionScope } from "@langwatch/experiment-contract";
import type { RunPayload } from "./schemas";

/**
 * Map a `workbench.run` payload onto an ExecutionScope. Shared by the browser
 * handler and the backend fallback executor so the two dispatch paths can
 * never disagree about what a scoped run covers: targets and rows compose
 * (each filter applies), and an omitted filter means "all of that dimension"
 * exactly as the payload schema documents.
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
