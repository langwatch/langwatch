import { HStack } from "@chakra-ui/react";
import type { PeriodSelection } from "@langwatch/coding-agent-web";
import type React from "react";

import { computeRelativeWindow, PeriodSelector } from "~/components/PeriodSelector";
import { SearchInput } from "~/components/ui/SearchInput";

/**
 * The window the period control shows while no period has been picked. It is
 * a placeholder for the control's own inputs; the trigger reads "All time" and
 * nothing is filtered until the reader chooses a range.
 */
const PLACEHOLDER_PERIOD_PRESET = "30d";

/**
 * The two ways the list narrows: a word, and a stretch of time. Both are the
 * table's own state rather than the address bar's, because the page is one
 * table rather than a whole surface, and a period the reader never asked for
 * would hide the sessions that ran before this week.
 */
export const SessionsToolbar: React.FC<{
  search: string;
  periodSelection: PeriodSelection | null;
  onSearchChange: (value: string) => void;
  onPeriodChange: (selection: PeriodSelection | null) => void;
}> = ({ search, periodSelection, onSearchChange, onPeriodChange }) => (
  <HStack gap={2} width="full" justify="space-between">
    <SearchInput
      value={search}
      placeholder="Search sessions"
      maxWidth="320px"
      onChange={(event) => onSearchChange(event.target.value)}
    />
    <PeriodSelector
      period={
        periodSelection?.period ??
        computeRelativeWindow(PLACEHOLDER_PERIOD_PRESET, new Date())
      }
      mode={periodSelection?.mode ?? "relative"}
      label={periodSelection ? undefined : "All time"}
      setPeriod={(startDate, endDate) =>
        onPeriodChange({ period: { startDate, endDate }, mode: "absolute" })
      }
      setRelativePeriod={(presetKey) =>
        onPeriodChange({
          period: computeRelativeWindow(presetKey, new Date()),
          mode: "relative",
        })
      }
      clearPeriod={() => onPeriodChange(null)}
    />
  </HStack>
);
