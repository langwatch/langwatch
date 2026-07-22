import type { LangyContextChip } from "../stores/langyStore";
import { shortenChipId } from "./langyContextChips";

/**
 * What a context chip actually gives Langy, said out loud.
 *
 * A chip today is a bare label ("filtered: status:error", "3 traces selected")
 * and the user has no way to know what it puts in Langy's hands. Worse, one of
 * them is genuinely ambiguous: when you hand Langy a search, does it get THE
 * QUERY or does it get THE ROWS THE QUERY MATCHED? Those are different
 * capabilities and they lead the agent to different behaviour, so the product
 * has to pick one and say which.
 *
 * IT PICKS THE QUERY, and the reason is that the query strictly contains the
 * rows. Langy can run a search (it owns `langwatch trace search`), so handing it
 * the search hands it the results too, plus the ability to widen it, narrow it,
 * or count what it matches. Handing it a frozen list of rows would throw all of
 * that away and keep only the part it could have derived for itself. So:
 *
 *   filter     -> THE SEARCH. "Langy gets the search itself."
 *   selection  -> THE ROWS.   "Langy gets exactly these traces, and nothing else."
 *
 * That mapping is not a decision imposed on the data, it is a description of
 * it: `filterContextChip` already puts the query text in `ref`, and
 * `selectionContextChip` already puts the trace ids in `ref`. Each chip was
 * already the thing it naturally is. What was missing was anyone saying so.
 *
 * THE HOVER IS DERIVED FROM `ref`, NOT WRITTEN ALONGSIDE IT. `ref` is the field
 * that rides to the server, so describing anything else would be describing a
 * fiction that happens to sit next to the truth. If a chip sends three trace
 * ids, the hover shows three trace ids.
 */
export interface LangyChipExplanation {
  /** What Langy will do with this. One plain sentence. */
  action: string;
  /** The concrete thing being handed over, read straight off `ref`. */
  payload?: string;
}

/** Trace ids shown in full before the rest collapse into a count. */
const IDS_SHOWN = 3;

export function describeChipContext(
  chip: LangyContextChip,
): LangyChipExplanation {
  switch (chip.kind) {
    case "filter":
      return {
        action:
          "Langy gets the search itself, so it can run it, narrow it, or count what it matches.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "selection":
      return describeSelection(chip);

    case "trace":
      return {
        action: "Langy will read this trace, start to finish.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "evaluation":
      return {
        action: "Langy will read this evaluation and its recent results.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "experiment":
      return {
        action: "Langy will read this experiment and its runs.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "dataset":
      return {
        action: "Langy will read this dataset and its records.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "prompt":
      return {
        action: "Langy will read this prompt and its versions.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "scenario":
      return {
        action: "Langy will read this simulation run.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "dashboard":
      return {
        action: "Langy will read this dashboard.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "workflow":
      return {
        action: "Langy will read this workflow and how it is wired up.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "agent":
      return {
        action: "Langy will read this agent's configuration.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "automation":
      return {
        action: "Langy will read this automation — what fires it and what it does.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "annotation":
      return {
        action: "Langy will read this annotation and what it is attached to.",
        ...(chip.ref ? { payload: chip.ref } : {}),
      };

    case "project":
      return {
        action: "Langy always works in the project you have open.",
      };
  }
}

/**
 * A selection is the one chip whose payload changes shape. Picking rows by hand
 * sends those rows. "Select all matching" sends no rows at all, because there
 * may be ten thousand of them, so it sends the SEARCH they matched and the cap
 * that bounds it. Two different payloads, and the hover has to be honest about
 * which one the user is actually handing over.
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
 * "Select all matching" carries the SEARCH it matched, not a row list. The
 * prefix keeps it self-describing on the wire: without it the ref would be a
 * bare query string, indistinguishable from a hand-picked trace id.
 *
 * Kept here (not in the selection hook) because this module is the one that has
 * to read the payload back, and a format with one writer and one reader should
 * only be spelled out once.
 */
export const ALL_MATCHING_PREFIX = "all-matching:";

/** Mirrors `SELECT_ALL_MATCHING_CAP`; pinned by `langyChipContext.unit.test.ts`. */
const SELECTION_CAP = 10_000;
