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
import { type RefObject, useId } from "react";

import { IsolatedErrorBoundary } from "~/components/ui/IsolatedErrorBoundary";

import { useGovernedChartModel } from "../hooks/useGovernedChartModel";
import type { GovernedVegaViewStatus } from "../hooks/useGovernedVegaView";
import type {
  GovernedVegaLiteChartProps,
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
  const descriptionId = useId();
  const { containerRef, state, failures, warnings, isRefused } =
    useGovernedChartModel({ spec, datasets, columnsByDataset });

  return (
    <VStack align="stretch" gap={3} data-testid="governed-vega-chart">
      {isRefused && <GovernedChartFailure errors={failures} />}
      <GovernedChartWarnings warnings={warnings} />
      <IsolatedErrorBoundary scope="This chart could not be drawn">
        <GovernedChartCanvas
          containerRef={containerRef}
          ariaLabel={ariaLabel}
          descriptionId={descriptionId}
          status={state.status}
          isRefused={isRefused}
        />
      </IsolatedErrorBoundary>
    </VStack>
  );
}

function GovernedChartCanvas({
  containerRef,
  ariaLabel,
  descriptionId,
  status,
  isRefused,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  ariaLabel: string | undefined;
  descriptionId: string;
  status: GovernedVegaViewStatus;
  isRefused: boolean;
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
    <Box hidden={isRefused} display={isRefused ? "none" : undefined}>
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
