import type { LangyContextChip } from "../../../behavior/langy.store.ts";
import { useTraceExplorerScope } from "../../../behavior/trace-explorer-scope.ts";

/**
 * The Trace Explorer view as a composer chip. The scope itself is the
 * Explorer's to describe, so trace publishes the chip and Langy only reads it.
 */
export function useLangyTraceViewContext(): LangyContextChip {
  return useTraceExplorerScope((s) => s.viewChip);
}
