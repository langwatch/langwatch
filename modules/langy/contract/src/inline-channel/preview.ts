/**
 * Progressive preview (ADR-060 §7): client preview while fence streams.
 * Validates through same salvage as relay, keeps only latest valid card.
 * At settle, relay's part wins (reconciliation by blockId). See ADR-060.
 */
import { salvageLangyDerivedCard } from "./salvage.ts";
import type { LangyDerivedCard } from "../cards/derived-safe.ts";

export interface LangyDerivedCardPreview {
  /** The raw fence buffer last fed. */
  raw: string;
  /** The latest VALIDATING parsed card; null until a prefix validates. */
  card: LangyDerivedCard | null;
}

export const initialLangyDerivedCardPreview: LangyDerivedCardPreview = {
  raw: "",
  card: null,
};

/**
 * Advance one fence's preview with the buffer streamed so far. Pure: returns
 * the previous state when nothing changed, a new state otherwise.
 */
export function feedLangyDerivedCardPreview(
  state: LangyDerivedCardPreview | null | undefined,
  raw: string,
): LangyDerivedCardPreview {
  const previous = state ?? initialLangyDerivedCardPreview;
  if (previous.raw === raw) return previous;
  const parsed = salvageLangyDerivedCard(raw);
  return {
    raw,
    card: parsed.ok ? parsed.card : previous.card,
  };
}

/**
 * Drop every preview whose card the relay has settled: the stamped part is
 * the record, and rendering both would draw the card twice. Binding is by
 * blockId, never by position or timing.
 */
export function reconcileLangyDerivedCardPreviews<P extends { card: LangyDerivedCard | null }>({
  previews,
  settledCardIds,
}: {
  previews: readonly P[];
  settledCardIds: ReadonlySet<string>;
}): P[] {
  return previews.filter(
    (preview) => preview.card === null || !settledCardIds.has(preview.card.blockId),
  );
}
