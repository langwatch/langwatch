/**
 * Everything the governed chart decides before it draws anything.
 *
 * Validation, the value scan, the running Vega view, and the refusals and
 * warnings they produce are one chain: each step reads the last one's answer,
 * and none of them renders. Keeping the chain here leaves the component with
 * the part that is actually markup, and puts the hooks in a `.ts` module where
 * the repository expects them.
 *
 * @see ../components/GovernedVegaLiteChart.tsx — the only consumer
 */

import { useMemo } from "react";

import { referencedDatasetNames } from "../visualization/buildGovernedVegaSpec";
import { governedEmptyEncodingFailure } from "../visualization/governedChartFailures";
import {
  langwatchVegaConfig,
  langwatchVegaPinnedConfig,
} from "../visualization/langwatchVegaConfig";
import {
  encodedFieldsByDataset,
  scanGovernedChartValues,
} from "../visualization/scanGovernedChartValues";
import { validateVegaLiteSpec } from "../visualization/validateVegaLiteSpec";
import type {
  GovernedVegaLiteChartProps,
  VegaValidationError,
  VegaValidationWarning,
} from "../visualization/visualization.types";
import {
  type GovernedVegaViewState,
  useGovernedVegaView,
} from "./useGovernedVegaView";
import { useLangwatchVegaTokens } from "./useLangwatchVegaTokens";

export interface GovernedChartModel {
  /** Where the running view attaches, or would attach. */
  readonly containerRef: ReturnType<typeof useGovernedVegaView>["containerRef"];
  readonly state: GovernedVegaViewState;
  /** The refusals to show. Empty means nothing refused this chart. */
  readonly failures: readonly VegaValidationError[];
  readonly warnings: readonly VegaValidationWarning[];
  /** Whether a refusal is on screen, which is what hides the canvas. */
  readonly isRefused: boolean;
}

export function useGovernedChartModel({
  spec,
  datasets,
  columnsByDataset,
}: Omit<GovernedVegaLiteChartProps, "ariaLabel">): GovernedChartModel {
  const { colorMode, tokens } = useLangwatchVegaTokens();

  const themeConfig = useMemo(
    () => langwatchVegaConfig({ colorMode, tokens }),
    [colorMode, tokens],
  );
  const pinnedConfig = useMemo(
    () => langwatchVegaPinnedConfig({ tokens }),
    [tokens],
  );

  // Keyed on the row counts rather than `datasets` itself: a data-only
  // reload produces a new `datasets` object on every render, and keying on
  // its identity would re-run the bundled schema validation and the full
  // policy walk for a specification that did not change.
  const rowCountsByDataset = rowCounts(datasets);
  const rowCountsKey = JSON.stringify(rowCountsByDataset);

  const validation = useMemo(
    () =>
      validateVegaLiteSpec({
        spec,
        columnsByDataset,
        rowCountsByDataset,
      }),
    [spec, columnsByDataset, rowCountsKey],
  );

  const scan = useMemo(() => {
    if (!validation.ok) return null;
    const datasetNames = referencedDatasetNames({
      spec: validation.normalized,
      registered: Object.keys(datasets),
    });
    const fieldsByDataset = encodedFieldsByDataset({
      spec: validation.normalized,
      datasetNames,
      columnsByDataset,
    });
    return {
      fieldsByDataset,
      ...scanGovernedChartValues({
        encodedFieldsByDataset: fieldsByDataset,
        datasets,
        columnsByDataset,
      }),
    };
  }, [validation, datasets, columnsByDataset]);

  const isDrawable =
    validation.ok && scan !== null && !scan.allEncodedValuesEmpty;

  const { containerRef, state } = useGovernedVegaView({
    spec: validation.ok ? validation.normalized : null,
    datasets,
    themeConfig,
    pinnedConfig,
    colorMode,
    enabled: isDrawable,
  });

  const failures = collectFailures({
    validation,
    scan,
    viewFailure: state.failure,
  });

  return {
    containerRef,
    state,
    failures,
    warnings: [...validation.warnings, ...(scan?.warnings ?? [])],
    isRefused: failures.length > 0,
  };
}

/**
 * The refusals to show, in the order they were decided: a specification that
 * did not pass, then a result with nothing in it, then a failure from inside
 * the chart runtime. Only one kind is ever shown, because only one is ever
 * reached.
 */
function collectFailures({
  validation,
  scan,
  viewFailure,
}: {
  validation: ReturnType<typeof validateVegaLiteSpec>;
  scan: {
    fieldsByDataset: Readonly<Record<string, readonly string[]>>;
    allEncodedValuesEmpty: boolean;
  } | null;
  viewFailure: VegaValidationError | null;
}): readonly VegaValidationError[] {
  if (!validation.ok) return validation.errors;
  if (scan === null) return [];
  if (scan.allEncodedValuesEmpty) {
    return [
      governedEmptyEncodingFailure({ fieldsByDataset: scan.fieldsByDataset }),
    ];
  }
  if (viewFailure !== null) return [viewFailure];
  return [];
}

function rowCounts(
  datasets: GovernedVegaLiteChartProps["datasets"],
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(datasets).map(([name, rows]) => [name, rows.length]),
  );
}
