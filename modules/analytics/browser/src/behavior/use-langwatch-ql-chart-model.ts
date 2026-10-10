/**
 * Everything the LangWatchQL chart decides before it draws anything:
 * validation, the value scan, and the running Vega view form one chain
 * where each step reads the last one's answer, leaving only markup.
 * @see ../components/LangWatchQLVegaLiteChart.tsx — the only consumer
 */

import {
  referencedDatasetNames,
  lwqlEmptyEncodingFailure,
  encodedFieldsByDataset,
  scanLangWatchQLChartValues,
} from "@langwatch/analytics-contract/visualization";
import type {
  LangWatchQLDataset,
  LangWatchQLDatasetColumn,
  VegaLiteValidationResult,
  VegaValidationError,
  VegaValidationWarning,
  LangWatchQLVegaColorMode,
  LangWatchQLVegaConfig,
} from "@langwatch/analytics-contract/visualization";
import { validateVegaLiteSpec } from "@langwatch/analytics-contract/visualization/validation";
import { useMemo, useState, type RefObject } from "react";

import {
  type LangWatchQLVegaViewState,
  useLangWatchQLVegaView,
} from "./use-langwatch-ql-vega-view.ts";

export interface LangWatchQLChartModel {
  /** Where the running view attaches, or would attach. */
  readonly containerRef: RefObject<HTMLDivElement | null>;
  readonly state: LangWatchQLVegaViewState;
  /** The refusals to show. Empty means nothing refused this chart. */
  readonly failures: readonly VegaValidationError[];
  readonly warnings: readonly VegaValidationWarning[];
  /** Whether a refusal is on screen, which is what hides the canvas. */
  readonly isRefused: boolean;
}

export function useLangWatchQLChartModel({
  spec,
  datasets,
  columnsByDataset,
  themeConfig,
  pinnedConfig,
  colorMode,
}: {
  spec: unknown;
  datasets: Readonly<Record<string, LangWatchQLDataset>>;
  columnsByDataset: Readonly<Record<string, readonly LangWatchQLDatasetColumn[]>>;
  themeConfig: LangWatchQLVegaConfig;
  pinnedConfig: LangWatchQLVegaConfig;
  colorMode: LangWatchQLVegaColorMode;
}): LangWatchQLChartModel {
  // Keyed on the row counts rather than `datasets` itself: a data-only
  // reload produces a new `datasets` object on every render, and keying on
  // its identity would re-run the bundled schema validation and the full
  // policy walk for a specification that did not change.
  const currentRowCounts = rowCounts(datasets);
  const rowCountsKey = JSON.stringify(currentRowCounts);
  const [keyedRowCounts, setKeyedRowCounts] = useState({
    key: rowCountsKey,
    counts: currentRowCounts,
  });
  if (keyedRowCounts.key !== rowCountsKey) {
    setKeyedRowCounts({ key: rowCountsKey, counts: currentRowCounts });
  }
  const rowCountsByDataset =
    keyedRowCounts.key === rowCountsKey ? keyedRowCounts.counts : currentRowCounts;

  const validation = useMemo(
    () =>
      validateVegaLiteSpec({
        spec,
        columnsByDataset,
        rowCountsByDataset,
      }),
    [spec, columnsByDataset, rowCountsByDataset],
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
      ...scanLangWatchQLChartValues({
        encodedFieldsByDataset: fieldsByDataset,
        datasets,
        columnsByDataset,
      }),
    };
  }, [validation, datasets, columnsByDataset]);

  const isDrawable = validation.ok && scan !== null && !scan.allEncodedValuesEmpty;

  const { containerRef, state } = useLangWatchQLVegaView({
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
 * The refusals to show, in the order they were decided: a failed
 * specification, then an empty result, then a runtime failure. Only
 * one kind is ever shown, because only one is ever reached.
 */
function collectFailures({
  validation,
  scan,
  viewFailure,
}: {
  validation: VegaLiteValidationResult;
  scan: {
    fieldsByDataset: Readonly<Record<string, readonly string[]>>;
    allEncodedValuesEmpty: boolean;
  } | null;
  viewFailure: VegaValidationError | null;
}): readonly VegaValidationError[] {
  if (!validation.ok) return validation.errors;
  if (scan === null) return [];
  if (scan.allEncodedValuesEmpty) {
    return [lwqlEmptyEncodingFailure({ fieldsByDataset: scan.fieldsByDataset })];
  }
  if (viewFailure !== null) return [viewFailure];
  return [];
}

function rowCounts(datasets: Readonly<Record<string, LangWatchQLDataset>>): Record<string, number> {
  return Object.fromEntries(Object.entries(datasets).map(([name, rows]) => [name, rows.length]));
}
