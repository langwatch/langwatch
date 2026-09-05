import { filterContextChip } from "../../langy/hooks/use-langy-filter-context";
import type { LangyAttachedContext } from "@langwatch/langy-web";

/**
 * The half-written question the ask button leaves in the composer.
 */
export const SEARCH_HANDOFF_DRAFT = "Find traces where ";

/**
 * The search bar's handoff to Langy — what the Ask AI composer becomes for a user who
 * has Langy (spec: specs/traces-v2/search.feature, "The search bar's ask affordance
 * belongs to Langy when Langy is available").
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
    // Nothing typed, so there is no question to ask yet — opening the panel ALONE is what made this button look
    // broken: you clicked "Ask Langy" and the only thing that happened was a panel appearing somewhere else on
    // screen, empty, with the search you were working on left behind.
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
