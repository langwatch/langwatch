/**
 * Progressive preview (ADR-060 §7) — the client-side reducer that lets
 * a card draw itself while its fence is still streaming.
 *
 * Feed it the raw text buffer between the fence open and the current stream
 * end, as often as chunks arrive. It repairs the partial JSON and validates
 * it through the SAME salvage + schema the relay will stamp with, and keeps
 * the latest VALIDATING parsed card — never a non-validating guess: until a
 * prefix validates there is no preview, and a chunk that breaks validation
 * mid-flight keeps the last good card on screen rather than flickering.
 *
 * Previews are a live-stream affair. At settle the relay's stamped part is
 * the truth: reconciliation is by blockId, and the settled part always wins
 * (`reconcileLangyDerivedCardPreviews`) — the same server-clock rule the text
 * merge already follows.
 */
import { salvageLangyDerivedCard } from "./salvage";
import type { LangyDerivedCard } from "../cards/derived-safe.js";

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
 * blockId — the block's identity from emission to durable part — never by
 * position or timing.
 */
export function reconcileLangyDerivedCardPreviews<
  P extends { card: LangyDerivedCard | null },
>({
  previews,
  settledCardIds,
}: {
  previews: readonly P[];
  settledCardIds: ReadonlySet<string>;
}): P[] {
  return previews.filter(
    (preview) =>
      preview.card === null || !settledCardIds.has(preview.card.blockId),
  );
}
