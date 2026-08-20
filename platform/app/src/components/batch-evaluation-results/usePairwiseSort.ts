import { useMemo, useState } from "react";
import type { BTLeaderboardEntry } from "./computeBTLeaderboard";

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
 * Rank is assigned from the incoming order, which arrives sorted by score desc
 * with degenerate variants sunk, and then travels with the variant. Re-sorting
 * by win rate therefore reorders the rows without renumbering them, so a
 * variant's standing stays readable in a view that is no longer ordered by it.
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
      entries.map((entry, i) => ({
        ...entry,
        rank: i + 1,
        name: variantNames[entry.variantId] ?? entry.variantId,
      })),
    [entries, variantNames],
  );

  const sorted = useMemo(() => {
    const arr = [...ranked];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortKey) {
        case "score":
          return (a.score - b.score) * dir;
        case "winRate":
          return ((a.winRate ?? -1) - (b.winRate ?? -1)) * dir;
        case "matchups":
          return (a.matchups - b.matchups) * dir;
        case "rank":
        default:
          return (a.rank - b.rank) * dir;
      }
    });
    return arr;
  }, [ranked, sortKey, sortDir]);

  // Re-picking the active column flips direction; picking a new one starts from
  // the direction that column is actually read in — rank ascends (1 is best),
  // every measure descends (bigger is better).
  const onSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "rank" ? "asc" : "desc");
    }
  };

  return { sorted, sortKey, sortDir, onSort };
}
