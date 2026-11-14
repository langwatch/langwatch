/**
 * Execution picker for an experiment's Run via API dialog: sequential (one cell
 * at a time in row order) or parallel with a concurrency. Drives the concurrency
 * every snippet starts the run with.
 */
import { HStack, Input, Text } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";
import { useState } from "react";

import {
  MAX_RUN_CONCURRENCY,
  type RunExecution,
} from "../../../model/run-via-api/run-execution.ts";

const ITEMS: { value: RunExecution["mode"]; label: string }[] = [
  { value: "sequential", label: "Sequential" },
  { value: "parallel", label: "Parallel" },
];

export function ExecutionPicker({
  value,
  onChange,
}: {
  value: RunExecution;
  onChange: (value: RunExecution) => void;
}) {
  const [draft, setDraft] = useState(String(value.parallelConcurrency));
  const [draftFrom, setDraftFrom] = useState(value.parallelConcurrency);
  if (draftFrom !== value.parallelConcurrency) {
    setDraftFrom(value.parallelConcurrency);
    setDraft(String(value.parallelConcurrency));
  }

  const commitDraft = () => {
    const parsed = Number(draft);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_RUN_CONCURRENCY) {
      onChange({ ...value, parallelConcurrency: parsed });
    } else {
      setDraft(String(value.parallelConcurrency));
    }
  };

  return (
    <HStack gap={2} data-testid="run-via-api-execution">
      <Text fontSize="xs" color="fg.muted" whiteSpace="nowrap">
        Execution
      </Text>
      <SegmentedControl
        size="xs"
        value={value.mode}
        onValueChange={({ value: next }) => {
          if (next) onChange({ ...value, mode: next as RunExecution["mode"] });
        }}
        items={ITEMS}
      />
      {value.mode === "parallel" ? (
        <Input
          aria-label="Concurrency"
          type="number"
          min={1}
          max={MAX_RUN_CONCURRENCY}
          size="xs"
          width="56px"
          textAlign="center"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") commitDraft();
          }}
        />
      ) : null}
    </HStack>
  );
}
