import type { TraceViewContextChip } from "@langwatch/trace-browser-kit";

import type { TraceLangyAskRequest, TraceLangyContext } from "../../../../behavior/trace-host.ts";
import { filterContextChip } from "../../langy/hooks/use-langy-filter-context.ts";

/**
 * The half-written question the ask button leaves in the composer. An
 * unfinished sentence on purpose: a full one reads as something already asked.
 */
export const SEARCH_HANDOFF_DRAFT = "Find traces where ";

/**
 * The search bar's handoff to Langy (spec: specs/traces-v2/search.feature, "The
 * search bar's ask affordance belongs to Langy when Langy is available"). Pure:
 * it builds the request the host carries, so the rules below are unit-testable.
 */
export function handOffSearchToLangy({
  typedText,
  appliedQueryText,
  viewContext,
}: {
  /** What is in the editor right now — becomes the question when non-empty. */
  typedText?: string;
  /** The applied filter query (the one the table is showing). */
  appliedQueryText: string;
  /** The whole Trace Explorer view, from `useTraceViewContext`. */
  viewContext?: TraceViewContextChip | null;
}): TraceLangyAskRequest {
  const prompt = typedText?.trim() ?? "";
  const context: TraceLangyContext[] = [];

  // The VIEW first — time range, lens, sort, grouping, applied search — so the
  // explicit route sends at least what the passive page context sends and
  // "these traces" means what is on screen.
  if (viewContext?.ref) {
    context.push({ kind: viewContext.kind, ref: viewContext.ref, label: viewContext.label });
  }

  // Then the applied search as its own chip, the one the agent applies as a
  // filter — unless the question IS that query, where attaching it would only
  // echo the prompt back as a chip.
  const chip = filterContextChip(appliedQueryText);
  if (chip?.ref && chip.ref !== prompt) {
    context.push({ kind: "filter", ref: chip.ref, label: chip.label });
  }

  // Nothing typed, so there is no question yet: open the composer with the
  // sentence started rather than an empty panel and the search left behind.
  return {
    ...(prompt ? { question: prompt } : { draft: SEARCH_HANDOFF_DRAFT }),
    ...(context.length > 0 ? { context } : {}),
  };
}
