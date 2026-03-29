import type { GroupInfo } from "../../../shared/types.ts";

export type StatusFilter = "all" | "ok" | "blocked" | "stale" | "active";

/** Stale is a subset of blocked (isStaleBlock implies isBlocked), so "blocked" excludes stale groups. */
export function matchesStatusFilter(g: GroupInfo, filter: StatusFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "ok": return !g.isBlocked && !g.isStaleBlock;
    case "blocked": return g.isBlocked && !g.isStaleBlock;
    case "stale": return g.isStaleBlock;
    case "active": return g.hasActiveJob && !g.isBlocked;
  }
}
