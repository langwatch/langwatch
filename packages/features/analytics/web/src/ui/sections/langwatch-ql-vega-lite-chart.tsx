/**
 * The LangWatchQL chart: validate, then draw, and never anything in between.
 *
 * The order is the whole design. A specification is checked against the
 * bundled Vega-Lite schema and the LangWatchQL policy *before* Vega is loaded with
 * it, the data is injected here rather than accepted from the specification,
 * and every way it can go wrong has a state of its own that names the cause.
 * There is no path through this component that renders an empty chart.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { Box, Stack, Text, VStack } from "@chakra-ui/react";
import { type RefObject, useId } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { useLangWatchQLChartModel } from "../../behavior/use-langwatch-ql-chart-model";
import type { LangWatchQLVegaViewStatus } from "../../behavior/use-langwatch-ql-vega-view";
import type {
  LangWatchQLVegaLiteChartProps,
  VegaValidationWarning,
} from "@langwatch/analytics-contract/visualization";

import { LangWatchQLChartFailure } from "../elements/langwatch-ql-chart-failure";

/** The minimum a chart is given, so a refusal never collapses the pane. */
const CHART_MIN_HEIGHT = "260px";

export function LangWatchQLVegaLiteChart({
  spec,
  datasets,
  columnsByDataset,
  ariaLabel,
  themeConfig,
  pinnedConfig,
  colorMode,
}: LangWatchQLVegaLiteChartProps) {
  const descriptionId = useId();
  const { containerRef, state, failures, warnings, isRefused } = useLangWatchQLChartModel({
    spec,
    datasets,
    columnsByDataset,
    themeConfig,
    pinnedConfig,
    colorMode,
  });

  return (
    <VStack align="stretch" gap={3} data-testid="lwql-vega-chart">
      {isRefused && <LangWatchQLChartFailure errors={failures} />}
      <LangWatchQLChartWarnings warnings={warnings} />
      <ErrorBoundary
        fallbackRender={() => (
          <LangWatchQLChartFailure
            errors={[
              {
                code: "render-failure",
                rule: "render.failure",
                path: "/",
                message:
                  "This chart could not be drawn. Try again or read the result in the table.",
              },
            ]}
          />
        )}
      >
        <LangWatchQLChartCanvas
          containerRef={containerRef}
          ariaLabel={ariaLabel}
          descriptionId={descriptionId}
          status={state.status}
          isRefused={isRefused}
        />
      </ErrorBoundary>
    </VStack>
  );
}

function LangWatchQLChartCanvas({
  containerRef,
  ariaLabel,
  descriptionId,
  status,
  isRefused,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  ariaLabel: string | undefined;
  descriptionId: string;
  status: LangWatchQLVegaViewStatus;
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
    <Box hidden={isRefused} display={isRefused ? "none" : void 0}>
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
        data-testid="lwql-vega-chart-view"
        data-chart-status={status}
      >
        <Box ref={containerRef} width="full" minHeight={CHART_MIN_HEIGHT} />
      </Box>
      <Text id={descriptionId} fontSize="12px" color="fg.muted">
        Drawn from the result of the query you ran. Switch to the table to read every returned row.
      </Text>
    </Box>
  );
}

function LangWatchQLChartWarnings({ warnings }: { warnings: readonly VegaValidationWarning[] }) {
  if (warnings.length === 0) return null;

  return (
    <Stack
      gap={1}
      padding={3}
      borderWidth="1px"
      borderColor="border"
      borderRadius="8px"
      role="status"
      data-testid="lwql-chart-warnings"
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
