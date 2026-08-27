/**
 * The filter row of the Results tab: how the list is grouped, what is cut from
 * it, and the window it all sits in.
 *
 * It reads above the numbers it drives. Filters first, then the stat strip and
 * the chart, then the table, so a person sets the question before reading the
 * answer rather than the other way round.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Button, HStack, NativeSelect } from "@chakra-ui/react";
import { ChartColumn } from "lucide-react";
import type { Period, RelativePresetKey } from "~/components/PeriodSelector";
import { FG_MUTED } from "../shared/design";
import { AgentTestingPeriodPicker } from "../shared/PeriodPicker";
import { GroupByTabs } from "./GroupByTabs";
import {
  ResultsFilterMenu,
  type ResultsFilterOption,
} from "./ResultsFilterMenu";
import {
  EMPTY_RESULT_FILTERS,
  isNarrowed,
  type ResultFilters,
  type ResultGrouping,
} from "./result-atoms";

export type ResultsFilterRowProps = {
  grouping: ResultGrouping;
  onGroupingChange: (grouping: ResultGrouping) => void;
  filters: ResultFilters;
  onFiltersChange: (filters: ResultFilters) => void;
  /** Built from everything in the window, not from what the filters left. */
  scenarioOptions: ResultsFilterOption[];
  labelOptions: ResultsFilterOption[];
  targetOptions: ResultsFilterOption[];
  isChartsShown: boolean;
  onChartsToggle: () => void;
  period: Period;
  setRelativePeriod: (key: RelativePresetKey) => void;
};

export function ResultsFilterRow({
  grouping,
  onGroupingChange,
  filters,
  onFiltersChange,
  scenarioOptions,
  labelOptions,
  targetOptions,
  isChartsShown,
  onChartsToggle,
  period,
  setRelativePeriod,
}: ResultsFilterRowProps) {
  return (
    <HStack
      gap={1.5}
      flexWrap="wrap"
      data-testid="agent-testing-results-filter-row"
    >
      <GroupByTabs grouping={grouping} onGroupingChange={onGroupingChange} />

      <Box width="1px" height="20px" background="border" marginX={1} />

      <ResultsFilterMenu
        label="Scenario"
        options={scenarioOptions}
        selected={filters.scenarioIds}
        onChange={(scenarioIds) => onFiltersChange({ ...filters, scenarioIds })}
      />
      <ResultsFilterMenu
        label="Label"
        options={labelOptions}
        selected={filters.labels}
        onChange={(labels) => onFiltersChange({ ...filters, labels })}
      />
      <ResultsFilterMenu
        label="Target"
        options={targetOptions}
        selected={filters.targetKeys}
        onChange={(targetKeys) => onFiltersChange({ ...filters, targetKeys })}
      />

      <NativeSelect.Root size="sm" width="auto" minWidth="120px">
        <NativeSelect.Field
          value={filters.status}
          aria-label="Filter by status"
          data-testid="results-filter-status"
          onChange={(event) =>
            onFiltersChange({
              ...filters,
              status: event.target.value as ResultFilters["status"],
            })
          }
        >
          <option value="all">All statuses</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>

      {isNarrowed(filters) ? (
        <Button
          size="xs"
          variant="ghost"
          height="32px"
          fontSize="11.5px"
          fontWeight="medium"
          color={FG_MUTED}
          onClick={() => onFiltersChange(EMPTY_RESULT_FILTERS)}
        >
          Reset filters
        </Button>
      ) : null}

      {/* An on and off control, so the pressed state is the only signal it
          needs. A caret would promise a menu that is not there. */}
      <Button
        size="xs"
        variant="outline"
        height="32px"
        paddingX="10px"
        fontSize="12.5px"
        fontWeight="medium"
        gap={1.5}
        aria-pressed={isChartsShown}
        colorPalette={isChartsShown ? "blue" : undefined}
        background={isChartsShown ? "blue.subtle" : undefined}
        borderColor={isChartsShown ? "blue.emphasized" : undefined}
        color={isChartsShown ? "blue.fg" : undefined}
        onClick={onChartsToggle}
        data-testid="results-charts-toggle"
      >
        <ChartColumn size={13} />
        Charts
      </Button>

      <Box flex={1} minWidth={2} />

      <AgentTestingPeriodPicker
        period={period}
        setRelativePeriod={setRelativePeriod}
      />
    </HStack>
  );
}
