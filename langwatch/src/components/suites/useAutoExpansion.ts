/**
 * Auto-expansion logic for run history rows.
 *
 * Expands only the most recent row on first load for a given panel (mounting
 * every batch's card grid at once made large sets laggy), auto-expands new
 * arrivals, and resets when groupBy changes.
 *
 * Expansion state is keyed by `panelKey` (e.g., scenarioSetId or "all-runs")
 * so that switching between panels preserves which rows were manually
 * collapsed. "Seen" ids are tracked separately from expanded ids so that
 * rows present-but-collapsed on first load are not mistaken for new arrivals
 * on the next refresh.
 *
 * @see specs/suites/simulations-performance.feature
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface UseAutoExpansionOptions {
  /** Unique key for this panel — expansion state is tracked per key */
  panelKey: string;
  groupBy: string;
  batchRuns: { batchRunId: string }[];
  groups: { groupKey: string }[];
}

const STORAGE_KEY = "langwatch:run-history-expanded";

type PanelState = { expanded: Set<string>; seen: Set<string> };

/**
 * Module-level cache of expanded/seen state per panel+groupBy.
 * Preserves the user's manual collapse/expand across panel switches and
 * navigation. Synced to localStorage so state persists across page loads.
 */
const panelStateCache = new Map<string, PanelState>();

// Hydrate from localStorage on module load. Supports the legacy format where
// each entry was a plain array of expanded ids (treated as both expanded and
// seen, matching the old expand-all behavior those entries were saved under).
try {
  const stored =
    typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored) {
    const parsed = JSON.parse(stored) as Record<
      string,
      string[] | { expanded: string[]; seen: string[] }
    >;
    for (const [k, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        panelStateCache.set(k, {
          expanded: new Set(value),
          seen: new Set(value),
        });
      } else {
        panelStateCache.set(k, {
          expanded: new Set(value.expanded),
          seen: new Set(value.seen),
        });
      }
    }
  }
} catch {
  // Ignore parse errors
}

function persistToStorage() {
  try {
    const obj: Record<string, { expanded: string[]; seen: string[] }> = {};
    for (const [k, state] of panelStateCache) {
      obj[k] = { expanded: [...state.expanded], seen: [...state.seen] };
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {
    // localStorage full or unavailable
  }
}

function cacheKey(panelKey: string, groupBy: string): string {
  return `${panelKey}::${groupBy}`;
}

export function useAutoExpansion({
  panelKey,
  groupBy,
  batchRuns,
  groups,
}: UseAutoExpansionOptions) {
  const key = cacheKey(panelKey, groupBy);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => panelStateCache.get(key)?.expanded ?? new Set(),
  );
  const prevGroupBy = useRef(groupBy);
  const prevPanelKey = useRef(panelKey);

  // Reset expanded state when groupBy or panelKey changes
  useEffect(() => {
    if (prevGroupBy.current !== groupBy || prevPanelKey.current !== panelKey) {
      const newKey = cacheKey(panelKey, groupBy);
      setExpandedIds(panelStateCache.get(newKey)?.expanded ?? new Set());
      prevGroupBy.current = groupBy;
      prevPanelKey.current = panelKey;
    }
  }, [groupBy, panelKey]);

  // Auto-expand: only the most recent row on first load (items arrive sorted
  // newest-first), and only genuinely new arrivals after that.
  useEffect(() => {
    const items = groupBy === "none" ? batchRuns : groups;
    if (items.length === 0) return;

    const currentIds = items.map((item) =>
      "batchRunId" in item
        ? item.batchRunId
        : (item as { groupKey: string }).groupKey,
    );

    const cached = panelStateCache.get(key);

    if (!cached) {
      // First load — expand only the newest row, mark everything as seen
      const newestId = currentIds[0];
      const state: PanelState = {
        expanded: new Set(newestId ? [newestId] : []),
        seen: new Set(currentIds),
      };
      panelStateCache.set(key, state);
      setExpandedIds(state.expanded);
      persistToStorage();
    } else {
      // Subsequent updates — expand only rows never seen before
      const newIds = currentIds.filter((id) => !cached.seen.has(id));
      if (newIds.length === 0) return;
      for (const id of newIds) {
        cached.seen.add(id);
        cached.expanded.add(id);
      }
      setExpandedIds(new Set(cached.expanded));
      persistToStorage();
    }
  }, [groupBy, batchRuns, groups, key]);

  // Sync cache on toggle
  const toggleExpanded = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        const cached = panelStateCache.get(key) ?? {
          expanded: new Set<string>(),
          seen: new Set<string>(),
        };
        cached.expanded = next;
        cached.seen.add(id);
        panelStateCache.set(key, cached);
        persistToStorage();
        return next;
      });
    },
    [key],
  );

  return { expandedIds, toggleExpanded };
}
