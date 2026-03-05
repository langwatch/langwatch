import { useState, useCallback, useRef } from "react";
import type { QueueInfo, GroupInfo } from "../../shared/types.ts";
import { ANTI_FLICKER_DURATION_MS } from "../../shared/constants.ts";

export interface DrainingGroup extends GroupInfo {
  _draining?: boolean;
  _drainingUntil?: number;
}

export type SortColumn = "pendingJobs" | "groupId" | "pipelineName" | "oldestJobMs" | "newestJobMs" | null;
export type SortDir = "asc" | "desc";

// Three-state sort cycle: null → desc → asc → null
type SortState = { column: SortColumn; dir: SortDir };

export function useGroupsData() {
  const [queues, setQueues] = useState<QueueInfo[]>([]);

  // Stable insertion order: queue name → groupId → insertion index
  const stableOrder = useRef<Map<string, Map<string, number>>>(new Map());
  const nextIndex = useRef<Map<string, number>>(new Map());

  // Previous group IDs per queue for detecting removals
  const prevGroupIds = useRef<Map<string, Set<string>>>(new Map());

  // Ghost rows currently draining out
  const drainingGroups = useRef<Map<string, Map<string, DrainingGroup>>>(new Map());

  // Previous state ref to avoid stale closure on `queues`
  const prevQueuesRef = useRef<QueueInfo[]>([]);

  // User-controlled sort — single state to avoid stale closures
  const [sortState, setSortState] = useState<SortState>({ column: null, dir: "desc" });

  const cycleSort = useCallback((column: SortColumn) => {
    setSortState((prev) => {
      if (prev.column !== column) {
        // New column: start with desc
        return { column, dir: "desc" };
      }
      if (prev.dir === "desc") {
        // Second click: desc → asc
        return { column, dir: "asc" };
      }
      // Third click: asc → reset to stable order
      return { column: null, dir: "desc" };
    });
  }, []);

  const update = useCallback((newQueues: QueueInfo[]) => {
    const now = Date.now();
    const prevQueues = prevQueuesRef.current;

    const result: QueueInfo[] = newQueues.map((queue) => {
      const newIds = new Set(queue.groups.map((g) => g.groupId));
      const prevIds = prevGroupIds.current.get(queue.name) ?? new Set();
      const drainingMap = drainingGroups.current.get(queue.name) ?? new Map<string, DrainingGroup>();
      const orderMap = stableOrder.current.get(queue.name) ?? new Map<string, number>();
      let idx = nextIndex.current.get(queue.name) ?? 0;

      // Mark disappeared groups as draining (using ref, not state)
      for (const id of prevIds) {
        if (!newIds.has(id) && !drainingMap.has(id)) {
          const prevGroup = prevQueues
            .find((q) => q.name === queue.name)
            ?.groups.find((g) => g.groupId === id);
          if (prevGroup) {
            drainingMap.set(id, {
              ...prevGroup,
              pendingJobs: 0,
              _draining: true,
              _drainingUntil: now + ANTI_FLICKER_DURATION_MS,
            });
          }
        }
      }

      // Clean expired draining groups and their insertion order
      for (const [id, g] of drainingMap) {
        if (g._drainingUntil && g._drainingUntil < now) {
          drainingMap.delete(id);
          orderMap.delete(id);
        }
      }

      // Remove from draining if reappeared
      for (const id of newIds) {
        drainingMap.delete(id);
      }

      // Rebuild stableOrder to only include currently visible groups + draining groups
      // This prevents unbounded growth of the Map
      const rebuiltOrderMap = new Map<string, number>();
      for (const group of queue.groups) {
        const existingIdx = orderMap.get(group.groupId);
        if (existingIdx !== undefined) {
          rebuiltOrderMap.set(group.groupId, existingIdx);
        } else {
          rebuiltOrderMap.set(group.groupId, idx++);
        }
      }
      for (const [id] of drainingMap) {
        const existingIdx = orderMap.get(id);
        if (existingIdx !== undefined) {
          rebuiltOrderMap.set(id, existingIdx);
        }
      }

      prevGroupIds.current.set(queue.name, newIds);
      drainingGroups.current.set(queue.name, drainingMap);
      stableOrder.current.set(queue.name, rebuiltOrderMap);
      nextIndex.current.set(queue.name, idx);

      const allGroups: (GroupInfo & { _draining?: boolean; _drainingUntil?: number })[] = [
        ...queue.groups,
        ...Array.from(drainingMap.values()),
      ];

      // Sort by stable insertion order by default
      allGroups.sort((a, b) => {
        const idxA = rebuiltOrderMap.get(a.groupId) ?? 0;
        const idxB = rebuiltOrderMap.get(b.groupId) ?? 0;
        return idxA - idxB;
      });

      return { ...queue, groups: allGroups };
    });

    prevQueuesRef.current = result;
    setQueues(result);
  }, []);

  return { queues, update, sortColumn: sortState.column, sortDir: sortState.dir, cycleSort };
}
