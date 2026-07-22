/**
 * Progressive block preview (ADR-060 §7) — the client-side reducer that lets
 * a card draw itself while its fence is still streaming.
 *
 * Feed it the raw text buffer between the fence open and the current stream
 * end, as often as chunks arrive. It repairs the partial JSON and validates
 * it through the SAME salvage + schema the relay will stamp with, and keeps
 * the latest VALIDATING parsed block — never a non-validating guess: until a
 * prefix validates there is no preview, and a chunk that breaks validation
 * mid-flight keeps the last good block on screen rather than flickering.
 *
 * Previews are a live-stream affair. At settle the relay's stamped part is
 * the truth: reconciliation is by blockId, and the settled part always wins
 * (`reconcileLangyCardBlockPreviews`) — the same server-clock rule the text
 * merge already follows.
 */
import { salvageLangyCardBlock } from "./salvage";
import type { LangyCardBlock } from "./schemas";

export interface LangyCardBlockPreview {
  /** The raw fence buffer last fed. */
  raw: string;
  /** The latest VALIDATING parsed block; null until a prefix validates. */
  block: LangyCardBlock | null;
}

export const initialLangyCardBlockPreview: LangyCardBlockPreview = {
  raw: "",
  block: null,
};

/**
 * Advance one fence's preview with the buffer streamed so far. Pure: returns
 * the previous state when nothing changed, a new state otherwise.
 */
export function feedLangyCardBlockPreview(
  state: LangyCardBlockPreview | null | undefined,
  raw: string,
): LangyCardBlockPreview {
  const previous = state ?? initialLangyCardBlockPreview;
  if (previous.raw === raw) return previous;
  const parsed = salvageLangyCardBlock(raw);
  return {
    raw,
    block: parsed.ok ? parsed.block : previous.block,
  };
}

/**
 * Drop every preview whose block the relay has settled: the stamped part is
 * the record, and rendering both would draw the card twice. Binding is by
 * blockId — the block's identity from emission to durable part — never by
 * position or timing.
 */
export function reconcileLangyCardBlockPreviews<
  P extends { block: LangyCardBlock | null },
>({
  previews,
  settledBlockIds,
}: {
  previews: readonly P[];
  settledBlockIds: ReadonlySet<string>;
}): P[] {
  return previews.filter(
    (preview) =>
      preview.block === null || !settledBlockIds.has(preview.block.blockId),
  );
}
