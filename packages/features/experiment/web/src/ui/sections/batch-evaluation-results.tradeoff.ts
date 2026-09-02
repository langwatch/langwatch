/**
 * The trade-off chart's conclusion, in words (#5103).
 *
 * A scatter carrying three metrics answers "what does this cost me?" only
 * after the reader has done the comparing. The comparing has an exact answer,
 * so it is done in `computeParetoDominance` and stated here; the chart is
 * then confirmation rather than the source.
 *
 * Two things this deliberately will not say:
 *
 *   - Nothing, when nothing is dominated. "No variant is beaten outright" is
 *     a real result — it means the field is a genuine trade-off and the call
 *     is the reader's — and staying silent would make an informative outcome
 *     indistinguishable from a check that never ran.
 *
 *   - "Beaten outright", when quality was the only comparable dimension.
 *     With no cost or duration recorded, dominance degenerates into the score
 *     ordering the leaderboard already shows, and dressing that up as a
 *     trade-off verdict would imply the run weighed things it never saw.
 */

import type {
  ParetoDominance,
  TradeoffDimension,
} from "./batch-evaluation-results.pareto";

export type TradeoffSummary = {
  headline: string;
  /**
   * `actionable` — something can be dropped. `neutral` — a real finding, but
   * not one that removes an option. Kept apart so the caller can style the
   * two differently without re-parsing the sentence.
   */
  tone: "actionable" | "neutral";
  /** Variants beaten outright, for the caller to mark on the chart. */
  droppableIds: string[];
};

const DIMENSION_WORDS: Record<TradeoffDimension, string> = {
  quality: "quality",
  cost: "cost",
  speed: "speed",
};

const joinWords = (words: string[]): string =>
  words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;

export const formatTradeoffSummary = ({
  dominance,
  variantNames,
}: {
  dominance: ParetoDominance;
  variantNames: Record<string, string>;
}): TradeoffSummary | null => {
  const nameOf = (id: string) => variantNames[id] ?? id;
  const rankedCount = Object.keys(dominance.dominatedBy).length;

  // One variant is not a trade-off, it is a result.
  if (rankedCount < 2) return null;

  if (dominance.dimensions.length < 2) {
    return {
      tone: "neutral",
      droppableIds: [],
      headline:
        "Only quality could be compared here — no cost or duration was recorded for every variant, so there is no trade-off to weigh.",
    };
  }

  const comparedOn = joinWords(dominance.dimensions.map((d) => DIMENSION_WORDS[d]));

  if (dominance.edges.length === 0) {
    return {
      tone: "neutral",
      droppableIds: [],
      headline: `No variant is beaten outright on ${comparedOn} — every one of them is better than the others at something, so this is a genuine trade-off.`,
    };
  }

  const droppableIds = Object.keys(dominance.dominatedBy).filter(
    (id) => (dominance.dominatedBy[id]?.length ?? 0) > 0,
  );

  if (droppableIds.length === 1) {
    const loserId = droppableIds[0]!;
    // The best-ranked variant that beats it — the one a reader would move to.
    const winnerId = dominance.dominatedBy[loserId]![0]!;
    const edge = dominance.edges.find(
      (e) => e.loserId === loserId && e.winnerId === winnerId,
    );
    const wonOn = joinWords(
      (edge?.strictlyBetterOn ?? []).map((d) => DIMENSION_WORDS[d]),
    );

    // "and no worse on the rest" is only true when there IS a rest. Appending
    // it unconditionally pointed the reader at dimensions that did not exist
    // whenever the winner swept every one of them — a small version of
    // exactly the fault this feature is built to avoid.
    const tiedOnSome = (edge?.strictlyBetterOn.length ?? 0) < dominance.dimensions.length;
    const clause = tiedOnSome ? ", and no worse on the rest" : "";

    return {
      tone: "actionable",
      droppableIds,
      headline: `${nameOf(loserId)} is beaten outright by ${nameOf(
        winnerId,
      )} — better on ${wonOn}${clause}. There is nothing it is buying you.`,
    };
  }

  return {
    tone: "actionable",
    droppableIds,
    headline: `${droppableIds.length} variants are beaten outright and can be dropped: ${joinWords(
      droppableIds.map(
        (id) => `${nameOf(id)} (by ${joinWords(dominance.dominatedBy[id]!.map(nameOf))})`,
      ),
    )}.`,
  };
};
