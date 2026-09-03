import { useMemo, useState } from "react";
import type { BTLeaderboardEntry } from "../model/batch-evaluation-results.bt-leaderboard";

export type SortKey = "rank" | "score" | "winRate" | "matchups";
export type SortDir = "asc" | "desc";

/** A leaderboard entry carrying its display rank and resolved variant name. */
export type RankedEntry = BTLeaderboardEntry & {
  rank: number;
  name: string;
};

/**
 * Sort state for the Bradley-Terry leaderboard table.
 *
 * Rank travels with the incoming score-sorted order, so sorting another column
 * does not renumber a variant's original standing.
 */
export function usePairwiseSort({
  entries,
  variantNames,
}: {
  entries: BTLeaderboardEntry[];
  variantNames: Record<string, string>;
}): {
  sorted: RankedEntry[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
} {
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const ranked = useMemo(
    () =>
      entries.map((entry, index) => ({
        ...entry,
        rank: index + 1,
        name: variantNames[entry.variantId] ?? entry.variantId,
      })),
    [entries, variantNames],
  );

  const sorted = useMemo(() => {
    const values = [...ranked];
    const direction = sortDir === "asc" ? 1 : -1;

    values.sort((left, right) => {
      switch (sortKey) {
        case "score":
          return (left.score - right.score) * direction;
        case "winRate":
          return ((left.winRate ?? -1) - (right.winRate ?? -1)) * direction;
        case "matchups":
          return (left.matchups - right.matchups) * direction;
        case "rank":
        default:
          return (left.rank - right.rank) * direction;
      }
    });

    return values;
  }, [ranked, sortKey, sortDir]);

  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((direction) => (direction === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDir(key === "rank" ? "asc" : "desc");
  };

  return { sorted, sortKey, sortDir, onSort };
}
