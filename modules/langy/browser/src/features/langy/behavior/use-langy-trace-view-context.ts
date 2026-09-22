import type { LangyContextChip } from "@langwatch/langy-browser-kit";
import { useTraceViewContext } from "@langwatch/trace-browser-kit";

/**
 * The Trace Explorer view as a composer chip. The scope itself is the
 * Explorer's to describe, so the chip is minted in its kit and only named here.
 */
export function useLangyTraceViewContext(): LangyContextChip {
  return useTraceViewContext();
}
