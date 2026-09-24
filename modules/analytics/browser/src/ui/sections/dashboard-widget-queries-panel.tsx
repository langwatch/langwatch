/**
 * Drawer Queries tab: every query as an accordion of `DashboardWidgetQueryRow`s. No save
 * of its own — the drawer's Footer saves both tabs — and no execution state of its own either:
 * `lastRuns`/`onRun` come from the card's shared executor, so Run here or in the chart agree.
 */

import { Accordion, VStack } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

import type { QueryLastRun } from "../../behavior/use-dashboard-widget-executor.ts";
import type { DashboardWidgetQuery } from "../../model/dashboard-widget-definition.ts";
import { DashboardWidgetQueryRow } from "./dashboard-widget-query-row.tsx";

/** The name a newly-added query gets, deduped against its siblings. */
export function nextQueryName(existing: DashboardWidgetQuery[]): string {
  const taken = new Set(existing.map((q) => q.name));
  let n = existing.length + 1;
  while (taken.has(`query${n}`)) n += 1;
  return `query${n}`;
}

/**
 * Query names that collide with a sibling — a row shows this inline instead of blocking typing.
 */
function duplicateNames(queries: DashboardWidgetQuery[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const q of queries) {
    if (seen.has(q.name)) dupes.add(q.name);
    seen.add(q.name);
  }
  return dupes;
}

/**
 * Whether every query has a name, and no two share one — the drawer's own Save gate reuses this.
 */
export function queryNamesAreValid(queries: DashboardWidgetQuery[]): boolean {
  return queries.every((q) => q.name.trim().length > 0) && duplicateNames(queries).size === 0;
}

/**
 * Realigns the index-keyed open-accordion values after `removedIndex` is
 * removed: drop that value and shift every value above it down by one,
 * so an open row keeps its state instead of a now-shifted index.
 */
export function remapOpenValuesAfterRemoval(openValues: string[], removedIndex: number): string[] {
  return openValues
    .filter((value) => Number(value) !== removedIndex)
    .map((value) => {
      const openIndex = Number(value);
      return openIndex > removedIndex ? String(openIndex - 1) : value;
    });
}

interface DashboardWidgetQueriesPanelProps {
  queries: DashboardWidgetQuery[];
  onChange: (queries: DashboardWidgetQuery[]) => void;
  lastRuns: Record<string, QueryLastRun>;
  onRun: (query: DashboardWidgetQuery) => Promise<void>;
}

export function DashboardWidgetQueriesPanel({
  queries,
  onChange,
  lastRuns,
  onRun,
}: DashboardWidgetQueriesPanelProps) {
  const [runningNames, setRunningNames] = useState<Set<string>>(new Set());
  const dupes = duplicateNames(queries);

  const handleRun = async (query: DashboardWidgetQuery) => {
    setRunningNames((prev) => new Set(prev).add(query.name));
    try {
      await onRun(query);
    } finally {
      setRunningNames((prev) => {
        const next = new Set(prev);
        next.delete(query.name);
        return next;
      });
    }
  };

  // The row's own value in the accordion — index-based, matching the key
  // below: a name mid-rename must not detach a row from its open/closed state.
  const valueOf = (index: number) => String(index);

  // Removing a row shifts every later row's index down by one, so the
  // index-keyed openValues must be remapped in the same beat — otherwise an
  // open row below the deleted one would be read against the wrong (or a
  // now-missing) index and lose its open state. Drop the deleted value and
  // decrement every value above it.
  const handleRemove = (index: number) => {
    onChange(queries.filter((_, i) => i !== index));
    setOpenValues((prev) => remapOpenValuesAfterRemoval(prev, index));
  };

  // Opens the first query by default so a drawer doesn't land fully collapsed.
  // Controlled, not defaultValue: DashboardWidgetQueryRow reads this to drive
  // its own chevron, since Chakra's built-in indicator never rotates here.
  const [openValues, setOpenValues] = useState<string[]>(queries.length > 0 ? [valueOf(0)] : []);

  // "+ Add query" (in the drawer's tab bar) appends straight to `queries` —
  // this panel doesn't own that action, so it notices the addition here
  // instead: a growing list opens the new (last) row and collapses whatever
  // was open before, so a member typing a new query isn't left hunting for
  // it under an already-open sibling.
  const previousLengthRef = useRef(queries.length);
  useEffect(() => {
    if (queries.length > previousLengthRef.current) {
      setOpenValues([valueOf(queries.length - 1)]);
    }
    previousLengthRef.current = queries.length;
  }, [queries.length]);

  return (
    <VStack align="stretch" gap={2} width="full" height="full" minHeight={0}>
      <Accordion.Root
        variant="plain"
        multiple
        collapsible
        value={openValues}
        onValueChange={(e) => setOpenValues(e.value)}
        flex={1}
        minHeight={0}
        overflowY="auto"
      >
        {queries.map((query, index) => {
          const blankNameError = query.name.trim() ? null : "Every query needs a name.";
          const nameError = dupes.has(query.name)
            ? "Another query already uses this name."
            : blankNameError;
          return (
            <DashboardWidgetQueryRow
              // Index, not name: a row mid-rename (typing toward a duplicate,
              // or briefly blank) must not remount and lose editor focus.
              key={index}
              value={valueOf(index)}
              isOpen={openValues.includes(valueOf(index))}
              query={query}
              nameError={nameError}
              onChange={(next) => {
                const updated = [...queries];
                updated[index] = next;
                onChange(updated);
              }}
              onRemove={() => handleRemove(index)}
              canRemove={queries.length > 1}
              onRun={() => void handleRun(query)}
              isRunning={runningNames.has(query.name)}
              lastRun={lastRuns[query.name]}
            />
          );
        })}
      </Accordion.Root>
    </VStack>
  );
}
