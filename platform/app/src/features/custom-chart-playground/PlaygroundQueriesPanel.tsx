/**
 * The drawer's Queries tab: every query the widget declares, as an accordion
 * of `PlaygroundQueryRow`s plus "+ Add query". No save affordance of its own
 * — Code and Queries edit one persisted record, so the drawer's own Footer
 * is the single Save for both tabs.
 *
 * Holds no execution state of its own — `lastRuns` and `onRun` come from the
 * card's `usePlaygroundWidgetExecutor`, the same instance the live chart
 * preview runs through, so a query's last result reads the same regardless
 * of whether the chart or this tab's own Run button produced it.
 */

import { Accordion, Button, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { useState } from "react";

import type { PlaygroundQuery } from "~/server/analytics/playgroundWidgetDefinition";

import { PlaygroundQueryRow } from "./PlaygroundQueryRow";
import type { QueryLastRun } from "./usePlaygroundWidgetExecutor";

/** The name a newly-added query gets, deduped against its siblings. */
function nextQueryName(existing: PlaygroundQuery[]): string {
  const taken = new Set(existing.map((q) => q.name));
  let n = existing.length + 1;
  while (taken.has(`query${n}`)) n += 1;
  return `query${n}`;
}

/** Query names that collide with a sibling — a row shows this inline instead of blocking typing. */
function duplicateNames(queries: PlaygroundQuery[]): Set<string> {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const q of queries) {
    if (seen.has(q.name)) dupes.add(q.name);
    seen.add(q.name);
  }
  return dupes;
}

/** Whether every query has a name, and no two share one — the drawer's own Save gate reuses this. */
export function queryNamesAreValid(queries: PlaygroundQuery[]): boolean {
  return (
    queries.every((q) => q.name.trim().length > 0) &&
    duplicateNames(queries).size === 0
  );
}

interface PlaygroundQueriesPanelProps {
  queries: PlaygroundQuery[];
  onChange: (queries: PlaygroundQuery[]) => void;
  lastRuns: Record<string, QueryLastRun>;
  onRun: (query: PlaygroundQuery) => Promise<void>;
}

export function PlaygroundQueriesPanel({
  queries,
  onChange,
  lastRuns,
  onRun,
}: PlaygroundQueriesPanelProps) {
  const [runningNames, setRunningNames] = useState<Set<string>>(new Set());
  const dupes = duplicateNames(queries);

  const handleRun = async (query: PlaygroundQuery) => {
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

  return (
    <VStack align="stretch" gap={2} height="full" minHeight={0}>
      <Accordion.Root
        variant="plain"
        multiple
        collapsible
        flex={1}
        minHeight={0}
        overflowY="auto"
      >
        {queries.map((query, index) => (
          <PlaygroundQueryRow
            // Index, not name: a row mid-rename (typing toward a duplicate,
            // or briefly blank) must not remount and lose editor focus.
            key={index}
            query={query}
            nameError={
              dupes.has(query.name)
                ? "Another query already uses this name."
                : !query.name.trim()
                  ? "Every query needs a name."
                  : null
            }
            onChange={(next) => {
              const updated = [...queries];
              updated[index] = next;
              onChange(updated);
            }}
            onRemove={() => onChange(queries.filter((_, i) => i !== index))}
            canRemove={queries.length > 1}
            onRun={() => void handleRun(query)}
            isRunning={runningNames.has(query.name)}
            lastRun={lastRuns[query.name]}
          />
        ))}
      </Accordion.Root>

      <Button
        size="xs"
        variant="ghost"
        alignSelf="flex-start"
        onClick={() =>
          onChange([...queries, { name: nextQueryName(queries), sql: "" }])
        }
      >
        <Plus /> Add query
      </Button>
    </VStack>
  );
}
