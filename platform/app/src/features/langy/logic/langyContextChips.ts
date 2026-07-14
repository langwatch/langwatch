import type { LangyContextChip } from "../stores/langyStore";

/**
 * Compose the candidate context-chip list from every source, in priority order.
 *
 * Callers pass their sources already flattened, MOST-SPECIFIC FIRST. The first
 * chip to claim an id wins; later duplicates are dropped. That ordering is what
 * makes a clicked target and an auto-derived one collapse into a single chip:
 * open the trace drawer for `abc123` (Langy derives `trace:abc123` from the
 * URL) and then click the same trace's row, and the composer still shows one
 * chip — the auto-derived one, whose label came from the richer source.
 *
 * Pure, so the merge rule can be unit-tested without a router or a store.
 */
export function mergeContextChips(
  sources: (LangyContextChip | null | undefined)[],
): LangyContextChip[] {
  const merged: LangyContextChip[] = [];
  const seen = new Set<string>();

  for (const chip of sources) {
    if (!chip || seen.has(chip.id)) continue;
    seen.add(chip.id);
    merged.push(chip);
  }

  return merged;
}

/**
 * Shorten a long id for a chip label: `3f9a01…c2`. Shared so a chip minted by a
 * clicked trace row reads identically to the one the route derives — same id,
 * same label, so they dedupe instead of stacking.
 */
export function shortenChipId(id: string): string {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-2)}`;
}

/** The stable chip a trace becomes, wherever it was picked up from. */
export function traceContextChip(
  traceId: string,
  displayName?: string | null,
): LangyContextChip {
  const name = displayName?.trim();
  return {
    id: `trace:${traceId}`,
    kind: "trace",
    // An id is useful to the tool, not to the person. Keep it in `ref` while
    // using the trace/span name anywhere the user has actually supplied one.
    label: name ? `Trace · ${name}` : `Trace · ${shortenChipId(traceId)}`,
    ref: traceId,
  };
}

/**
 * The stable chip a dataset becomes. The id is keyed on the dataset id alone,
 * so the chip a list row mints (which knows the name) and the one the
 * `/datasets/<id>` route derives (which doesn't) dedupe into one.
 */
export function datasetContextChip({
  datasetId,
  name,
}: {
  datasetId: string;
  name?: string;
}): LangyContextChip {
  return {
    id: `dataset:${datasetId}`,
    kind: "dataset",
    label: name ? `dataset: ${name}` : `dataset ${shortenChipId(datasetId)}`,
    ref: datasetId,
  };
}

/**
 * The stable chip a prompt becomes. Keyed on the prompt id (the same key the
 * prompt editor drawer derives), labelled by handle when one exists — the
 * handle is also what rides as `ref`, since it is the name the agent's own
 * prompt tools resolve.
 */
export function promptContextChip({
  promptId,
  handle,
}: {
  promptId: string;
  handle?: string | null;
}): LangyContextChip {
  return {
    id: `prompt:${promptId}`,
    kind: "prompt",
    label: handle ? `prompt: ${handle}` : `prompt ${shortenChipId(promptId)}`,
    ref: handle ?? promptId,
  };
}
