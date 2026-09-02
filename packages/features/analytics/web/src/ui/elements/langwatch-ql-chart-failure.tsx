/**
 * Every way a chart can fail to appear, and the words for each.
 *
 * A chart that cannot be drawn shows *why*, in its own state, naming the cause
 * and what to change. The one thing none of them does is render an empty box:
 * a blank plotting area is indistinguishable from a chart still loading, from
 * one encoding the wrong column, and from a bug.
 *
 * The copy map is exhaustive over the refusal codes at the type level, so a new
 * code cannot reach a member as an unexplained blank.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { Badge, Box, Stack, Text, VStack } from "@chakra-ui/react";

import type {
  VegaValidationError,
  VegaValidationErrorCode,
} from "../../model/visualization/visualization-types";

interface FailureCopy {
  /** What happened, in the member's terms. */
  readonly title: string;
  /** What to do about it. */
  readonly guidance: string;
}

/**
 * Keyed by the refusal code union, so adding a code without deciding what the
 * member reads is a type error rather than a blank panel.
 */
export const LWQL_CHART_FAILURE_COPY: Record<VegaValidationErrorCode, FailureCopy> = {
  "invalid-json": {
    title: "The chart specification is not valid JSON",
    guidance: "Fix the syntax below and the chart will redraw as you type.",
  },
  "spec-not-object": {
    title: "The chart specification must be a JSON object",
    guidance:
      "Paste the specification itself rather than a link to one, or start from the example.",
  },
  "unsupported-schema-version": {
    title: "That Vega-Lite version is not supported",
    guidance:
      "Charts here read Vega-Lite v6. Nothing is converted for you, because a converted chart can draw something different.",
  },
  "schema-failure": {
    title: "The chart specification does not match Vega-Lite",
    guidance: "Each position below names the property to change.",
  },
  "policy-rejection": {
    title: "That is not allowed in a chart here",
    guidance:
      "Charts draw only the result of the query you ran, so anything that reaches outside it is refused.",
  },
  "unknown-dataset": {
    title: "The chart names a dataset that does not exist",
    guidance: "Point the chart at one of the datasets listed below.",
  },
  "unknown-field": {
    title: "The chart names a column that is not in the result",
    guidance:
      "Use one of the columns the query returned, or change the query to return the one you want.",
  },
  "complexity-refusal": {
    title: "This chart asks for too much at once",
    guidance:
      "Nothing is sampled or dropped to make it fit. Narrow the query or simplify the chart, and read the full result in the table.",
  },
  "loader-blocked": {
    title: "The chart tried to load something from outside the result",
    guidance: "Charts read only the datasets registered for this result. The load was refused.",
  },
  "render-failure": {
    title: "The chart could not be drawn",
    guidance: "Change the specification, or read the result in the table.",
  },
  "empty-encoding": {
    title: "There is nothing to draw",
    guidance:
      "Every value this chart encodes is empty or missing. Encode a different column, or change the query.",
  },
};

export interface LangWatchQLChartFailureProps {
  /** The refusals, all of them, so one pass says everything to change. */
  readonly errors: readonly VegaValidationError[];
}

/**
 * The state a chart shows instead of itself. The code drives both the copy and
 * the test id, so "each case renders its own intentional state" is observable
 * rather than asserted about prose.
 */
export function LangWatchQLChartFailure({ errors }: LangWatchQLChartFailureProps) {
  const leading = errors[0];
  if (leading === void 0) return null;

  const copy = LWQL_CHART_FAILURE_COPY[leading.code];

  return (
    <VStack
      align="stretch"
      gap={3}
      padding={4}
      borderWidth="1px"
      borderColor="border"
      borderRadius="8px"
      role="status"
      data-testid="lwql-chart-failure"
      data-failure-code={leading.code}
    >
      <Stack gap={1}>
        <Text fontSize="14px" fontWeight="500">
          {copy.title}
        </Text>
        <Text fontSize="12.5px" color="fg.muted">
          {copy.guidance}
        </Text>
      </Stack>

      <Stack gap={2}>
        {errors.map((error, index) => (
          <Box key={`${error.rule}-${error.path}-${index}`}>
            <Text fontSize="12.5px">{error.message}</Text>
            <Badge size="sm" variant="subtle" fontFamily="mono">
              {error.path}
            </Badge>
          </Box>
        ))}
      </Stack>
    </VStack>
  );
}
