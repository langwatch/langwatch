// Auto-expand most recent row per panel, reset on groupBy change.

import { readUiStorage, writeUiStorage } from "@langwatch/browser-host/storage";
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
 * navigation. Remembered on the device so state persists across page loads.
 */
const panelStateCache = new Map<string, PanelState>();

let hydrated = false;

/**
 * Read back what this device remembers, the first time a panel asks — on
 * first use, not module load, since the shell installs the store while it
 * mounts. Supports the legacy format: a plain array of ids, treated as both expanded and seen.
 */
function hydrateFromStorage(): void {
  if (hydrated) return;

  hydrated = true;
  try {
    const stored = readUiStorage(STORAGE_KEY);
    if (!stored) return;

    const parsed = JSON.parse(stored) as Record<
      string,
      string[] | { expanded: string[]; seen: string[] }
    >;
    for (const [k, value] of Object.entries(parsed)) {
      panelStateCache.set(
        k,
        Array.isArray(value)
          ? { expanded: new Set(value), seen: new Set(value) }
          : { expanded: new Set(value.expanded), seen: new Set(value.seen) },
      );
    }
  } catch {
    // Ignore parse errors
  }
}

function persistToStorage() {
  const obj: Record<string, { expanded: string[]; seen: string[] }> = {};
  for (const [k, state] of panelStateCache) {
    obj[k] = { expanded: [...state.expanded], seen: [...state.seen] };
  }
  writeUiStorage(STORAGE_KEY, JSON.stringify(obj));
}

function cacheKey(panelKey: string, groupBy: string): string {
  return `${panelKey}::${groupBy}`;
}

function applyAutoExpansion({
  key,
  currentIds,
  setExpandedIds,
}: {
  key: string;
  currentIds: string[];
  setExpandedIds: (ids: Set<string>) => void;
}): void {
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
    // Subsequent updates — items arrive newest-first, so unseen ids in
    // front of the first already-seen id are genuinely new arrivals and
    // auto-expand. Unseen ids behind a seen one were paginated in (Load
    // More / widened period): mark them seen without expanding, otherwise
    // every Load More would mount the whole loaded page at once.
    const unseenIds = currentIds.filter((id) => !cached.seen.has(id));
    if (unseenIds.length === 0) return;
    const firstSeenIndex = currentIds.findIndex((id) => cached.seen.has(id));
    const newArrivals =
      firstSeenIndex === -1 ? currentIds.slice(0, 1) : currentIds.slice(0, firstSeenIndex);
    for (const id of unseenIds) cached.seen.add(id);
    for (const id of newArrivals) cached.expanded.add(id);
    setExpandedIds(new Set(cached.expanded));
    persistToStorage();
  }
}

export function useAutoExpansion({
  panelKey,
  groupBy,
  batchRuns,
  groups,
}: UseAutoExpansionOptions) {
  hydrateFromStorage();
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
      "batchRunId" in item ? item.batchRunId : (item as { groupKey: string }).groupKey,
    );

    applyAutoExpansion({ key, currentIds, setExpandedIds });
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
