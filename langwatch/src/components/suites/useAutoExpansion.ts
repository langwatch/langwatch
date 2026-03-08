/**
 * Auto-expansion logic for run history rows.
 *
 * Expands all rows on first load, auto-expands new arrivals,
 * and resets when groupBy changes.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Identifiable {
  batchRunId?: string;
  groupKey?: string;
}

interface UseAutoExpansionOptions {
  groupBy: string;
  batchRuns: { batchRunId: string }[];
  groups: { groupKey: string }[];
}

export function useAutoExpansion({
  groupBy,
  batchRuns,
  groups,
}: UseAutoExpansionOptions) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);
  const prevGroupBy = useRef(groupBy);

  // Reset expanded state when groupBy changes
  useEffect(() => {
    if (prevGroupBy.current !== groupBy) {
      setExpandedIds(new Set());
      hasAutoExpanded.current = false;
      prevGroupBy.current = groupBy;
    }
  }, [groupBy]);

  // Auto-expand: all rows on first load, and any newly arriving rows
  useEffect(() => {
    if (groupBy === "none" && batchRuns.length > 0) {
      const currentIds = new Set(batchRuns.map((b) => b.batchRunId));
      if (!hasAutoExpanded.current) {
        setExpandedIds(currentIds);
        hasAutoExpanded.current = true;
      } else {
        setExpandedIds((prev) => {
          const newIds = [...currentIds].filter((id) => !prev.has(id));
          if (newIds.length === 0) return prev;
          const next = new Set(prev);
          for (const id of newIds) next.add(id);
          return next;
        });
      }
    } else if (groupBy !== "none" && groups.length > 0) {
      const currentKeys = new Set(groups.map((g) => g.groupKey));
      if (!hasAutoExpanded.current) {
        setExpandedIds(currentKeys);
        hasAutoExpanded.current = true;
      } else {
        setExpandedIds((prev) => {
          const newKeys = [...currentKeys].filter((k) => !prev.has(k));
          if (newKeys.length === 0) return prev;
          const next = new Set(prev);
          for (const k of newKeys) next.add(k);
          return next;
        });
      }
    }
  }, [groupBy, batchRuns, groups]);

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  return { expandedIds, toggleExpanded };
}
