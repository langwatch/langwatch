import type { LangyContextChip } from "./langy.store.ts";
import { shortenChipId } from "./langy-context-chips.ts";

/**
 * What a context chip actually gives Langy, said out loud.
 */
export interface LangyChipExplanation {
  /** What Langy will do with this. One plain sentence. */
  action: string;
  /** The concrete thing being handed over, read straight off `ref`. */
  payload?: string;
}

/** Trace ids shown in full before the rest collapse into a count. */
const IDS_SHOWN = 3;

/**
 * One plain-sentence action per chip kind, for every kind whose payload is
 * simply `chip.ref` (or nothing, for "project"). "selection" is handled
 * separately below because its payload shape depends on what was selected.
 */
const CHIP_ACTIONS: Record<Exclude<LangyContextChip["kind"], "selection">, string> = {
  filter: "Langy gets the search itself, so it can run it, narrow it, or count what it matches.",
  trace: "Langy will read this trace, start to finish.",
  evaluation: "Langy will read this evaluation and its recent results.",
  experiment: "Langy will read this experiment and its runs.",
  dataset: "Langy will read this dataset and its records.",
  prompt: "Langy will read this prompt and its versions.",
  scenario: "Langy will read this simulation run.",
  dashboard: "Langy will read this dashboard.",
  workflow: "Langy will read this workflow and how it is wired up.",
  agent: "Langy will read this agent's configuration.",
  automation: "Langy will read this automation, what fires it and what it does.",
  annotation: "Langy will read this annotation and what it is attached to.",
  project: "Langy always works in the project you have open.",
};

export function describeChipContext(chip: LangyContextChip): LangyChipExplanation {
  if (chip.kind === "selection") return describeSelection(chip);
  return {
    action: CHIP_ACTIONS[chip.kind],
    ...(chip.ref ? { payload: chip.ref } : {}),
  };
}

/**
 * A selection is the one chip whose payload changes shape. Picking rows by hand sends
 * those rows. "Select all matching" sends no rows at all, because there may be ten
 * thousand of them, so it sends the SEARCH they matched and the cap that bounds it.
 */
function describeSelection(chip: LangyContextChip): LangyChipExplanation {
  const ref = chip.ref ?? "";

  if (ref.startsWith(ALL_MATCHING_PREFIX)) {
    const query = ref.slice(ALL_MATCHING_PREFIX.length);
    return {
      action: query
        ? `Langy gets your search, not a fixed list, so it works from everything the search matches (up to ${SELECTION_CAP.toLocaleString()} traces).`
        : `Langy works from every trace in the time range you are looking at (up to ${SELECTION_CAP.toLocaleString()}).`,
      ...(query ? { payload: query } : {}),
    };
  }

  const ids = ref ? ref.split(",").filter(Boolean) : [];
  if (ids.length === 0) {
    return { action: "Langy will read the traces you picked." };
  }
  if (ids.length === 1) {
    return {
      action: "Langy will read this trace, start to finish.",
      payload: ids[0]!,
    };
  }

  return {
    action: `Langy gets exactly these ${ids.length} traces, and works from those and nothing else.`,
    payload: summariseIds(ids),
  };
}

/** `3f9a01…c2, 8b21c4…7f, 1d0e99…aa, and 12 more` */
function summariseIds(ids: string[]): string {
  const shown = ids.slice(0, IDS_SHOWN).map(shortenChipId).join(", ");
  const rest = ids.length - IDS_SHOWN;
  return rest > 0 ? `${shown}, and ${rest.toLocaleString()} more` : shown;
}

/**
 * "Select all matching" carries the SEARCH it matched, not a row list. The prefix keeps
 * it self-describing on the wire: without it the ref would be a bare query string,
 * indistinguishable from a hand-picked trace id.
 */
export const ALL_MATCHING_PREFIX = "all-matching:";

/** Mirrors `SELECT_ALL_MATCHING_CAP`; pinned by `langyChipContext.unit.test.ts`. */
const SELECTION_CAP = 10_000;
