/**
 * A specification is validated against the bundled Vega-Lite schema and
 * the LangWatchQL policy *before* Vega loads it, so no path through this
 * component renders an empty chart.
 * @see modules/analytics/specs/analytics-lwql-workbench.feature
 */

import { Box, Stack, Text, VStack } from "@chakra-ui/react";
import type {
  LangWatchQLVegaLiteChartProps,
  VegaValidationWarning,
} from "@langwatch/analytics-contract/visualization";
import { type RefObject, useId } from "react";
import { ErrorBoundary } from "react-error-boundary";

import { useLangWatchQLChartModel } from "../../behavior/use-langwatch-ql-chart-model.ts";
import type { LangWatchQLVegaViewStatus } from "../../behavior/use-langwatch-ql-vega-view.ts";
import { LangWatchQLChartFailure } from "../elements/langwatch-ql-chart-failure.tsx";

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
    The mount point stays in the tree (hidden, not removed) while a refusal
    is shown: removing it would deadlock, since the re-embed effect for a
    corrected spec would find no container to draw into.
  */
  return (
    <Box hidden={isRefused} display={isRefused ? "none" : void 0}>
      <Box
        // The label lives on this wrapper, never the mount point: Vega
        // writes its own role="graphics-document" and aria-label onto the
        // element it embeds into, so a label there would not survive.
        // role="img" also keeps that inner labelling from being read twice.
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
      as="output"
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
