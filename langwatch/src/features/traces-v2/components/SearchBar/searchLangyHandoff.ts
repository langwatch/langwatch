import { filterContextChip } from "~/features/langy/hooks/useLangyFilterContext";
import type { LangyAttachedContext } from "~/features/langy/stores/langyStore";

/**
 * The half-written question the ask button leaves in the composer.
 *
 * Deliberately an unfinished sentence: it says what this is for, and the caret
 * lands after it with the reader's half still to write. "Ask Langy about these
 * traces" as a full sentence would be a label, and a label in a text box reads
 * as something already asked.
 */
export const SEARCH_HANDOFF_DRAFT = "Find traces where ";

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
  seedDraft,
}: {
  /** What is in the editor right now — becomes the question when non-empty. */
  typedText?: string;
  /** The applied filter query (the one the table is showing). */
  appliedQueryText: string;
  askLangy: (prompt: string) => void;
  openPanel: () => void;
  attachContext: (item: LangyAttachedContext) => void;
  /** Seed the composer, but never over something already half-written. */
  seedDraft: (text: string) => void;
}): void {
  const prompt = typedText?.trim() ?? "";

  if (prompt) {
    askLangy(prompt);
  } else {
    // Nothing typed, so there is no question to ask yet — opening the panel
    // ALONE is what made this button look broken: you clicked "Ask Langy" and
    // the only thing that happened was a panel appearing somewhere else on
    // screen, empty, with the search you were working on left behind.
    //
    // Open it with the sentence already started instead. The filter rides over
    // as context (below), so what the reader completes here is answered against
    // the traces they were actually looking at — and starting the line is what
    // makes it obvious Langy will write the query, rather than expecting one.
    openPanel();
    seedDraft(SEARCH_HANDOFF_DRAFT);
  }

  // Attach AFTER the ask: `askLangy` resets conversation-scoped state, and the
  // attachment belongs to the conversation being started, not the previous one.
  const chip = filterContextChip(appliedQueryText);
  if (chip?.ref && chip.ref !== prompt) {
    attachContext({ type: "filter", id: chip.ref, label: chip.label });
  }
}
