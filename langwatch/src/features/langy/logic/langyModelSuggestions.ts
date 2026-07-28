import type { LangyModelGroup } from "./langyModelProfile";

/**
 * Which models the picker offers up front, and which it keeps behind "More".
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────
 *
 * The picker lists every model the project's providers expose, grouped by
 * capability. That is the right CATALOGUE and the wrong FRONT DOOR: on a
 * project with several providers enabled it is a scrolling wall of near-
 * identical names, presented as if choosing between them were a decision the
 * user is equipped to make. Almost nobody wants to choose a model. They want
 * the one that works, and occasionally they want a specific other one.
 *
 * So the list splits: a short shortlist you can read at a glance, and the full
 * grouped catalogue one click away.
 *
 * ── WHAT MAKES A MODEL "SUGGESTED" ─────────────────────────────────────────
 *
 * Nothing is hardcoded by name — a curated list of model ids would be stale
 * within a release and wrong for any project with its own providers. The
 * shortlist is DERIVED, in this order:
 *
 *   1. The Langy default. Whatever the project's routing resolves to is what
 *      you get by not choosing, so it must be the first thing you see.
 *   2. The current selection. If you have already picked something, the picker
 *      must show it without making you open "More" to find your own choice.
 *   3. One representative from each primary capability group, in the order a
 *      person actually reasons about the trade-off: something fast, something
 *      general, something that thinks harder.
 *
 * Deduped, capped, order preserved. Multimodal and custom models are
 * deliberately NOT auto-suggested: both are specific asks, and a user who wants
 * one goes looking for it.
 */

/** The shortlist stays scannable. Past this it is a list again, not a shortlist. */
export const SUGGESTED_MODEL_LIMIT = 5;

/**
 * The groups a representative is drawn from, in the order they are offered.
 * `multimodal` and `custom` are absent on purpose — see the module doc.
 */
const REPRESENTED_GROUPS: LangyModelGroup[] = ["quick", "balanced", "reasoning"];

/** The minimum a model must expose for the split to reason about it. */
export interface SplittableModel {
  value: string;
  profile: { group: LangyModelGroup };
}

export interface LangyModelSplit<T> {
  suggested: T[];
  more: T[];
}

/**
 * Split a model list into the shortlist and the rest.
 *
 * `searching` collapses the split entirely: a user who has typed a query is
 * looking for a specific model, and a search that hides half its own matches
 * behind a disclosure is a search that lies. Everything matching goes into
 * `more` (the grouped view), and the shortlist is empty.
 */
export function splitLangyModels<T extends SplittableModel>({
  items,
  langyDefaultModel,
  selectedModel,
  searching = false,
}: {
  items: T[];
  /** The model the project's routing resolves to, if any. */
  langyDefaultModel?: string | null;
  /** The model currently chosen, so the picker always shows your own choice. */
  selectedModel?: string | null;
  /** A filter query is active. */
  searching?: boolean;
}): LangyModelSplit<T> {
  if (searching || items.length === 0) {
    return { suggested: [], more: items };
  }

  const byValue = new Map(items.map((item) => [item.value, item]));
  const picked = new Map<string, T>();

  const take = (value: string | null | undefined) => {
    if (!value || picked.has(value)) return;
    const item = byValue.get(value);
    if (item) picked.set(value, item);
  };

  take(langyDefaultModel);
  take(selectedModel);

  for (const group of REPRESENTED_GROUPS) {
    if (picked.size >= SUGGESTED_MODEL_LIMIT) break;
    const representative = items.find(
      (item) => item.profile.group === group && !picked.has(item.value),
    );
    if (representative) picked.set(representative.value, representative);
  }

  // A shortlist of one is not a shortlist — it is the same list with a
  // disclosure bolted on. Below two entries the split earns nothing, so the
  // catalogue is shown as it always was.
  if (picked.size < 2) return { suggested: [], more: items };

  // PICK order, not catalogue order: the default has to lead, and the
  // representatives read fast → general → thinks-harder, which is the order a
  // person actually weighs the trade-off in. `more` keeps catalogue order,
  // because that IS the catalogue.
  const suggested = [...picked.values()];
  const more = items.filter((item) => !picked.has(item.value));
  return { suggested, more };
}
