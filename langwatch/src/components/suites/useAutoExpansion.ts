/**
 * Auto-expansion logic for run history rows.
 *
 * Expands all rows on first load for a given panel, auto-expands new arrivals,
 * and resets when groupBy changes.
 *
 * Expansion state is keyed by `panelKey` (e.g., scenarioSetId or "all-runs")
 * so that switching between panels preserves which rows were manually collapsed.
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

/**
 * Module-level cache of which panels have already had their initial auto-expand.
 * Survives component remounts so switching panels doesn't re-expand everything.
 */
const autoExpandedPanels = new Set<string>();

/**
 * Module-level cache of expanded/collapsed state per panel+groupBy.
 * Preserves user's manual collapse/expand across panel switches and navigation.
 * Synced to localStorage so state persists across page transitions.
 */
const expandedStateCache = new Map<string, Set<string>>();

// Hydrate from localStorage on module load
try {
  const stored = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored) {
    const parsed = JSON.parse(stored) as Record<string, string[]>;
    for (const [k, ids] of Object.entries(parsed)) {
      expandedStateCache.set(k, new Set(ids));
      autoExpandedPanels.add(k);
    }
  }
} catch {
  // Ignore parse errors
}

function persistToStorage() {
  try {
    const obj: Record<string, string[]> = {};
    for (const [k, ids] of expandedStateCache) {
      obj[k] = [...ids];
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
    () => expandedStateCache.get(key) ?? new Set(),
  );
  const prevGroupBy = useRef(groupBy);
  const prevPanelKey = useRef(panelKey);

  // Reset expanded state when groupBy or panelKey changes
  useEffect(() => {
    if (prevGroupBy.current !== groupBy || prevPanelKey.current !== panelKey) {
      const newKey = cacheKey(panelKey, groupBy);
      const cached = expandedStateCache.get(newKey);
      if (cached) {
        setExpandedIds(cached);
      } else {
        setExpandedIds(new Set());
        // Mark as not-yet-auto-expanded for this new key so first data triggers expansion
        autoExpandedPanels.delete(newKey);
      }
      prevGroupBy.current = groupBy;
      prevPanelKey.current = panelKey;
    }
  }, [groupBy, panelKey]);

  // Auto-expand: all rows on first load, and only newly arriving rows after that
  useEffect(() => {
    const items = groupBy === "none" ? batchRuns : groups;
    if (items.length === 0) return;

    const currentIds = new Set(
      items.map((item) =>
        "batchRunId" in item ? item.batchRunId : (item as { groupKey: string }).groupKey,
      ),
    );

    if (!autoExpandedPanels.has(key)) {
      // First load — expand all
      setExpandedIds(currentIds);
      expandedStateCache.set(key, currentIds);
      autoExpandedPanels.add(key);
      persistToStorage();
    } else {
      // Subsequent updates — only add genuinely new rows
      setExpandedIds((prev) => {
        const newIds = [...currentIds].filter((id) => !prev.has(id));
        if (newIds.length === 0) return prev;
        const next = new Set(prev);
        for (const id of newIds) next.add(id);
        expandedStateCache.set(key, next);
        persistToStorage();
        return next;
      });
    }
  }, [groupBy, batchRuns, groups, key]);

  // Sync cache on toggle
  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      expandedStateCache.set(key, next);
      persistToStorage();
      return next;
    });
  }, [key]);

  return { expandedIds, toggleExpanded };
}
