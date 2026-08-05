/**
 * The governed chart: validate, then draw, and never anything in between.
 *
 * The order is the whole design. A specification is checked against the
 * bundled Vega-Lite schema and the governed policy *before* Vega is loaded with
 * it, the data is injected here rather than accepted from the specification,
 * and every way it can go wrong has a state of its own that names the cause.
 * There is no path through this component that renders an empty chart.
 *
 * @see specs/analytics/governed-sql-workbench.feature
 */

import { Box, Stack, Text, VStack } from "@chakra-ui/react";
import { type RefObject, useId, useMemo } from "react";

import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";

import {
  type GovernedVegaViewStatus,
  useGovernedVegaView,
} from "../hooks/useGovernedVegaView";
import { useLangwatchVegaTokens } from "../hooks/useLangwatchVegaTokens";
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

import { GovernedChartFailure } from "./GovernedChartFailure";

/** The minimum a chart is given, so a refusal never collapses the pane. */
const CHART_MIN_HEIGHT = "260px";

export function GovernedVegaLiteChart({
  spec,
  datasets,
  columnsByDataset,
  ariaLabel,
}: GovernedVegaLiteChartProps) {
  const { colorMode, tokens } = useLangwatchVegaTokens();
  const descriptionId = useId();

  const themeConfig = useMemo(
    () => langwatchVegaConfig({ colorMode, tokens }),
    [colorMode, tokens],
  );
  const pinnedConfig = useMemo(
    () => langwatchVegaPinnedConfig({ tokens }),
    [tokens],
  );

  const validation = useMemo(
    () =>
      validateVegaLiteSpec({
        spec,
        columnsByDataset,
        rowCountsByDataset: rowCounts(datasets),
      }),
    [spec, columnsByDataset, datasets],
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

  const drawable =
    validation.ok && scan !== null && !scan.allEncodedValuesEmpty;

  const { containerRef, state } = useGovernedVegaView({
    spec: validation.ok ? validation.normalized : null,
    datasets,
    themeConfig,
    pinnedConfig,
    colorMode,
    enabled: drawable,
  });

  const failures = collectFailures({
    validation,
    scan,
    viewFailure: state.failure,
  });
  const warnings: readonly VegaValidationWarning[] = [
    ...validation.warnings,
    ...(scan?.warnings ?? []),
  ];

  const refused = failures.length > 0;

  return (
    <VStack align="stretch" gap={3} data-testid="governed-vega-chart">
      {refused && <GovernedChartFailure errors={failures} />}
      <GovernedChartWarnings warnings={warnings} />
      <IsolatedErrorBoundary scope="This chart could not be drawn">
        <GovernedChartCanvas
          containerRef={containerRef}
          ariaLabel={ariaLabel}
          descriptionId={descriptionId}
          status={state.status}
          refused={refused}
        />
      </IsolatedErrorBoundary>
    </VStack>
  );
}

/**
 * Where Vega draws, and the sentence that says what it drew.
 *
 * @param refused Whether a refusal is on screen above this.
 */
function GovernedChartCanvas({
  containerRef,
  ariaLabel,
  descriptionId,
  status,
  refused,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  ariaLabel: string | undefined;
  descriptionId: string;
  status: GovernedVegaViewStatus;
  refused: boolean;
}) {
  /*
    The mount point stays in the tree while a refusal is shown, so a
    corrected specification has somewhere to draw into. Removing it was a
    deadlock: the refusal outlives the render that clears it, so the
    effect that re-embeds would find no container and give up, and the
    chart would never come back.

    Hidden, it is out of the layout and out of the accessibility tree, so
    nothing renders an empty plotting area.
  */
  return (
    <Box hidden={refused} display={refused ? "none" : undefined}>
      <Box
        // The chart is a picture of the result. Its accessible name is the
        // whole of what a reader who cannot see it gets from this element —
        // the same rows are in the table, which is the real fallback.
        //
        // The name lives HERE, on a wrapper, and never on the mount point:
        // Vega writes its own `role="graphics-document"` and
        // `aria-label="Vega visualization"` onto the element it embeds
        // into, so a label on the mount point does not survive a real
        // embed. `role="img"` also makes everything inside this element
        // presentational, so Vega's own labelling is not read twice.
        role="img"
        aria-label={ariaLabel ?? "Chart of the query result"}
        aria-describedby={descriptionId}
        aria-busy={status === "embedding"}
        data-testid="governed-vega-chart-view"
        data-chart-status={status}
      >
        <Box ref={containerRef} width="full" minHeight={CHART_MIN_HEIGHT} />
      </Box>
      <Text id={descriptionId} fontSize="12px" color="fg.muted">
        Drawn from the result of the query you ran. Switch to the table to read
        every returned row.
      </Text>
    </Box>
  );
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

function GovernedChartWarnings({
  warnings,
}: {
  warnings: readonly VegaValidationWarning[];
}) {
  if (warnings.length === 0) return null;

  return (
    <Stack
      gap={1}
      padding={3}
      borderWidth="1px"
      borderColor="border"
      borderRadius="8px"
      role="status"
      data-testid="governed-chart-warnings"
    >
      {warnings.map((warning, index) => (
        <Text
          key={`${warning.code}-${warning.path}-${index}`}
          fontSize="12.5px"
          color="fg.muted"
          data-warning-code={warning.code}
        >
          {warning.message}
        </Text>
      ))}
    </Stack>
  );
}

function rowCounts(
  datasets: GovernedVegaLiteChartProps["datasets"],
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(datasets).map(([name, rows]) => [name, rows.length]),
  );
}
