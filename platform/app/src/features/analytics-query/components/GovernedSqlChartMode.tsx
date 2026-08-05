/**
 * Chart mode: the editor for the specification, and the chart it describes.
 *
 * This is the whole of what the result pane mounts for the Chart tab. It owns
 * the specification text — in memory, for as long as the member is looking at
 * this result — and nothing else. It holds no query hook and cannot cause a
 * request: switching modes or editing a chart never re-runs SQL.
 *
 * The query result is registered as a dataset named `query_result`, which is
 * the only name a specification may read here. It is registered by name rather
 * than pasted into the specification so a Reload can push new rows into the
 * running chart instead of rebuilding it.
 *
 * The default export is the lazy-loading boundary's target: everything Vega is
 * reached from here, so no other route loads any of it.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Button, HStack, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";

import { starterVegaLiteSpecText } from "../visualization/starterVegaLiteSpec";
import {
  parseVegaLiteSpecText,
  validateVegaLiteSpec,
} from "../visualization/validateVegaLiteSpec";
import type {
  GovernedDatasetColumn,
  VegaValidationError,
} from "../visualization/visualization.types";

import { GovernedChartFailure } from "./GovernedChartFailure";
import { GovernedVegaLiteChart } from "./GovernedVegaLiteChart";
import { VegaLiteSpecEditor } from "./VegaLiteSpecEditor";

/** The dataset name the workbench registers its result under. */
export const GOVERNED_QUERY_RESULT_DATASET = "query_result";

/** The shape of a governed SQL result, narrowed to what a chart reads. */
export interface GovernedSqlChartResult {
  readonly columns: readonly GovernedDatasetColumn[];
  readonly rows: readonly Record<string, unknown>[];
}

export interface GovernedSqlChartModeProps {
  readonly result: GovernedSqlChartResult;
  /**
   * How the result is described to a reader who cannot see the chart — the
   * query it came from, when the pane knows it.
   */
  readonly submittedLabel?: string;
}

const starterFor = (result: GovernedSqlChartResult): string =>
  starterVegaLiteSpecText({
    columns: result.columns,
    datasetName: GOVERNED_QUERY_RESULT_DATASET,
  });

export function GovernedSqlChartMode({
  result,
  submittedLabel,
}: GovernedSqlChartModeProps) {
  // Seeded once. An edited specification is the member's work and is never
  // replaced behind their back when new rows arrive; the reset button is how
  // they ask for the starting point again.
  const [specText, setSpecText] = useState(() => starterFor(result));

  const datasets = useMemo(
    () => ({ [GOVERNED_QUERY_RESULT_DATASET]: result.rows }),
    [result.rows],
  );
  const columnsByDataset = useMemo(
    () => ({ [GOVERNED_QUERY_RESULT_DATASET]: result.columns }),
    [result.columns],
  );

  const parsed = useMemo(() => parseVegaLiteSpecText(specText), [specText]);
  const errors = useMemo(
    (): readonly VegaValidationError[] =>
      parsed.ok
        ? refusalsOf(
            validateVegaLiteSpec({
              spec: parsed.spec,
              columnsByDataset,
              rowCountsByDataset: {
                [GOVERNED_QUERY_RESULT_DATASET]: result.rows.length,
              },
            }),
          )
        : parsed.errors,
    [parsed, columnsByDataset, result.rows.length],
  );

  return (
    <VStack align="stretch" gap={3} data-testid="governed-sql-chart-mode">
      <HStack justify="space-between" align="start" gap={2}>
        <VegaLiteSpecEditor
          specText={specText}
          onSpecTextChange={setSpecText}
          errors={errors}
        />
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setSpecText(starterFor(result))}
          data-testid="vega-spec-reset"
        >
          Reset to the example
        </Button>
      </HStack>

      {parsed.ok ? (
        <GovernedVegaLiteChart
          spec={parsed.spec}
          datasets={datasets}
          columnsByDataset={columnsByDataset}
          ariaLabel={
            submittedLabel === undefined
              ? "Chart of the query result"
              : `Chart of the result of ${submittedLabel}`
          }
        />
      ) : (
        // Text that does not parse never becomes a candidate specification, so
        // this refusal belongs here rather than to the chart, which is only
        // ever handed something already parsed.
        <GovernedChartFailure errors={parsed.errors} />
      )}
    </VStack>
  );
}

function refusalsOf(
  result: ReturnType<typeof validateVegaLiteSpec>,
): readonly VegaValidationError[] {
  return result.ok ? [] : result.errors;
}

export default GovernedSqlChartMode;
