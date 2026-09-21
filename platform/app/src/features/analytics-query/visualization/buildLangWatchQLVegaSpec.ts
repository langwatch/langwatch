/**
 * Turning a validated specification into the one Vega is actually handed.
 *
 * Two things happen here and nowhere else:
 *
 *   1. DATA IS INJECTED, never accepted. The member's specification names
 *      datasets; it never carries them. This builds the `datasets` block from
 *      the registry the renderer was given, after deleting anything the caller
 *      put there — the policy already refuses a caller-supplied `datasets`, so
 *      this is the second lock rather than the first, and it is the one that
 *      holds if the first is ever loosened.
 *
 *      `usermeta` goes the same way and for the same reason. vega-embed reads
 *      `usermeta.embedOptions` off the specification and lets a `loader` found
 *      there replace the one the caller passed — which is the deny-everything
 *      loader — so a single spec property could put the network back. The
 *      policy refuses that property; this is what holds if it stops.
 *   2. THE PINNED CONFIG IS APPLIED LAST, over whatever `config` the member
 *      wrote. That is the top of a three-layer chain, and each layer is applied
 *      at exactly one seam:
 *
 *          the LangWatch theme   → the chart runtime's `config` option
 *          the member's `config` → the specification, as written
 *          the pinned overrides  → here, merged over both
 *
 *      A member may restyle an axis; a member may not change the background the
 *      chart is drawn on or the font it is drawn in.
 *
 * The input specification is never mutated: everything works on a deep clone.
 */

import type { LangWatchQLVegaConfig } from "./langwatchVegaConfig";
import { isPlainObject, visitJsonObjects } from "./vegaLiteStructure";
import type { LangWatchQLDataset } from "./visualization.types";

/**
 * Top-level keys that make a specification a composition Vega-Lite refuses to
 * size against its container. `"width": "container"` is only meaningful for a
 * single or layered view, so the responsive default is applied only to those.
 */
const NON_CONTAINER_SIZED_KEYS = [
  "facet",
  "repeat",
  "concat",
  "hconcat",
  "vconcat",
] as const;

export interface BuildLangWatchQLVegaSpecInput {
  /** The specification `validateVegaLiteSpec` accepted, unmodified. */
  readonly spec: unknown;
  /** Every dataset registered for this result, keyed by name. */
  readonly datasets: Readonly<Record<string, LangWatchQLDataset>>;
  /** The values the member's own `config` may not override. */
  readonly pinnedConfig: LangWatchQLVegaConfig;
}

export interface LangWatchQLVegaSpecBuild {
  /** The specification to hand to the chart runtime. */
  readonly spec: Record<string, unknown>;
  /**
   * The dataset names the running view knows, which are the names a data-only
   * update may push new rows into.
   */
  readonly datasetNames: readonly string[];
}

/**
 * Names every registered dataset the specification reads.
 *
 * The order is the traversal's, not the document's: `visitJsonObjects` pops a
 * LIFO stack, so only the root is position-guaranteed. Nothing depends on the
 * order — these names only key `view.data(name, rows)` calls — and saying
 * "document order" would promise a guarantee the walk does not give.
 *
 * These are the names Vega-Lite keeps verbatim in the compiled specification,
 * which is what makes `view.data(name, rows)` addressable at all.
 */
export function referencedDatasetNames({
  spec,
  registered,
}: {
  spec: unknown;
  registered: readonly string[];
}): string[] {
  const names: string[] = [];
  for (const { parentKey, node } of visitJsonObjects(spec)) {
    if (parentKey !== "data") continue;
    const name = node.name;
    if (typeof name !== "string") continue;
    if (!registered.includes(name)) continue;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

export function buildLangWatchQLVegaSpec({
  spec,
  datasets,
  pinnedConfig,
}: BuildLangWatchQLVegaSpecInput): LangWatchQLVegaSpecBuild {
  const clone = cloneSpec(spec);
  const datasetNames = referencedDatasetNames({
    spec: clone,
    registered: Object.keys(datasets),
  });

  // Whatever the caller wrote here is discarded before anything is added.
  delete clone.datasets;
  clone.datasets = Object.fromEntries(
    datasetNames.map((name) => [name, [...(datasets[name] ?? [])]]),
  );

  // Nothing the chart runtime reads for its own configuration survives the
  // build. Vega renders no `usermeta` — it is metadata for tools — so removing
  // it costs a LangWatchQL chart nothing.
  delete clone.usermeta;

  clone.config = mergeConfig({
    base: isPlainObject(clone.config) ? clone.config : {},
    override: pinnedConfig,
  });
  clone.background = "transparent";

  applyContainerSizing(clone);

  return { spec: clone, datasetNames };
}

/**
 * A responsive default, not an override: a member who states a width keeps it.
 * Without this a specification that says nothing about size renders at
 * Vega-Lite's fixed default and ignores the pane it sits in.
 */
function applyContainerSizing(spec: Record<string, unknown>): void {
  const isComposition = NON_CONTAINER_SIZED_KEYS.some((key) => key in spec);
  if (isComposition) return;
  if (!("mark" in spec) && !("layer" in spec)) return;
  if (!("width" in spec)) spec.width = "container";
}

/**
 * A deep clone through JSON, which is exactly the right depth: a specification
 * is JSON by definition, and the size and depth ceilings have already refused
 * anything large enough for this to cost.
 */
function cloneSpec(spec: unknown): Record<string, unknown> {
  const cloned: unknown = JSON.parse(JSON.stringify(spec));
  return isPlainObject(cloned) ? cloned : {};
}

/** Deep merge where `override` wins, plain objects merging key by key. */
export function mergeConfig({
  base,
  override,
}: {
  base: Readonly<Record<string, unknown>>;
  override: Readonly<Record<string, unknown>>;
}): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = merged[key];
    merged[key] =
      isPlainObject(existing) && isPlainObject(value)
        ? mergeConfig({ base: existing, override: value })
        : value;
  }
  return merged;
}
