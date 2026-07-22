import { filterContextChip } from "~/features/langy/hooks/useLangyFilterContext";
import type { LangyAttachedContext } from "~/features/langy/stores/langyStore";

/**
 * The search bar's handoff to Langy — what the Ask AI composer becomes for a
 * user who has Langy (spec: specs/traces-v2/search.feature, "The search bar's
 * ask affordance belongs to Langy when Langy is available").
 *
 * Pure, mirroring the command bar's `beginLangyHandoff`: everything it needs
 * arrives as arguments, so the rules below are unit-testable without React or
 * the stores.
 *
 *   - A typed question is asked outright (`askLangy` opens the panel on a
 *     fresh conversation and auto-sends); with nothing typed the panel just
 *     opens, ready for the user to write.
 *   - The APPLIED search — the query driving the table — rides along as
 *     attached context, so "these traces" means what the user is looking at.
 *   - Unless the question IS the applied query (⌘⏎ on an already-applied
 *     filter): attaching it too would only echo the prompt back as a chip.
 */
export function handOffSearchToLangy({
  typedText,
  appliedQueryText,
  askLangy,
  openPanel,
  attachContext,
}: {
  /** What is in the editor right now — becomes the question when non-empty. */
  typedText?: string;
  /** The applied filter query (the one the table is showing). */
  appliedQueryText: string;
  askLangy: (prompt: string) => void;
  openPanel: () => void;
  attachContext: (item: LangyAttachedContext) => void;
}): void {
  const prompt = typedText?.trim() ?? "";

  if (prompt) {
    askLangy(prompt);
  } else {
    openPanel();
  }

  // Attach AFTER the ask: `askLangy` resets conversation-scoped state, and the
  // attachment belongs to the conversation being started, not the previous one.
  const chip = filterContextChip(appliedQueryText);
  if (chip?.ref && chip.ref !== prompt) {
    attachContext({ type: "filter", id: chip.ref, label: chip.label });
  }
}
