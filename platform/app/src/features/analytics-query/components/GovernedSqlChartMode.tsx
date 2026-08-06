/**
 * Chart and Specification: the chart the specification describes, and the
 * editor for the specification itself.
 *
 * This is the whole of what the result pane mounts for both views. It owns
 * the specification text — in memory, for as long as the member is looking at
 * this result — and nothing else. It holds no query hook and cannot cause a
 * request: switching views or editing a chart never re-runs SQL.
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

import { Badge, Box, Button, HStack, Stack, Text, VStack } from "@chakra-ui/react";
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
  /** Which reading is on screen. The specification state is shared across both. */
  readonly view?: "chart" | "specification";
  /** Switches the result pane to the Specification view. */
  readonly onOpenSpecification?: () => void;
}

const starterFor = (result: GovernedSqlChartResult): string =>
  starterVegaLiteSpecText({
    columns: result.columns,
    datasetName: GOVERNED_QUERY_RESULT_DATASET,
  });

/**
 * What a member can rely on the policy accepting, said next to where they type.
 *
 * A reference, not the rulebook: the validator's refusals each name their own
 * rule and JSON pointer, so this list only has to orient. Every line states a
 * fact the policy modules enforce — marks in `vegaLitePolicy.ts` (image is the
 * one refusal), transforms in `ALLOWED_VEGA_LITE_TRANSFORMS`, the dataset name
 * in this file.
 */
function SpecPolicyPanel({
  errors,
  summaryLine,
  onViewChart,
}: {
  errors: readonly VegaValidationError[];
  summaryLine: string;
  onViewChart?: (() => void) | undefined;
}) {
  const valid = errors.length === 0;

  return (
    <Box
      width="304px"
      flexShrink={0}
      overflowY="auto"
      background="bg.subtle"
      borderLeftWidth="1px"
      borderColor="border"
      padding={4}
      data-testid="vega-spec-policy-panel"
    >
      {valid ? (
        <>
          <Badge
            size="sm"
            variant="subtle"
            colorPalette="green"
            borderRadius="full"
            marginBottom={2}
          >
            Valid
          </Badge>
          <Text fontSize="12px" color="fg.muted" lineHeight="1.6">
            {summaryLine}
          </Text>
        </>
      ) : (
        <>
          <Badge
            size="sm"
            variant="subtle"
            colorPalette="red"
            borderRadius="full"
            marginBottom={2}
          >
            Refused
          </Badge>
          <Stack gap={2} data-testid="vega-spec-editor-problems">
            {errors.map((error, index) => (
              <Box
                key={`${error.rule}-${error.path}-${index}`}
                borderWidth="1px"
                borderColor="border"
                borderRadius="8px"
                overflow="hidden"
                background="bg.panel"
                data-error-code={error.code}
              >
                <Text
                  fontFamily="mono"
                  fontSize="11px"
                  fontWeight="700"
                  color="red.fg"
                  paddingX={3}
                  paddingY={1.5}
                  borderBottomWidth="1px"
                  borderColor="border"
                >
                  {error.path}
                </Text>
                <Text fontSize="12px" lineHeight="1.6" paddingX={3} paddingY={2}>
                  {error.message}
                </Text>
              </Box>
            ))}
          </Stack>
        </>
      )}

      {valid && onViewChart && (
        <Button
          variant="plain"
          size="xs"
          height="auto"
          padding={0}
          marginTop={1}
          fontSize="12px"
          fontWeight="600"
          color="orange.fg"
          textDecoration="underline"
          onClick={onViewChart}
        >
          View the chart
        </Button>
      )}

      <Text
        fontSize="10.5px"
        fontWeight="700"
        letterSpacing="0.05em"
        textTransform="uppercase"
        color="fg.subtle"
        marginTop={5}
        marginBottom={2}
      >
        The policy accepts
      </Text>
      <Stack gap={1.5} fontSize="11.5px" lineHeight="1.5" color="fg.muted">
        <Text>
          Vega-Lite v6, drawing only from the dataset named{" "}
          <Text as="span" fontFamily="mono" fontSize="11px" color="fg">
            query_result
          </Text>{" "}
          — the rows the query returned.
        </Text>
        <Text>
          Every mark except{" "}
          <Text as="span" fontFamily="mono" fontSize="11px" color="fg">
            image
          </Text>
          , which loads remote resources.
        </Text>
        <Text>
          Reviewed transforms — filter, calculate, aggregate, bin, timeUnit,
          stack, fold, flatten, lookup, joinaggregate, window.
        </Text>
        <Text>
          Expressions over{" "}
          <Text as="span" fontFamily="mono" fontSize="11px" color="fg">
            datum
          </Text>{" "}
          fields; nothing that reaches the network or the page.
        </Text>
        <Text>Your own titles, colors, scales, tooltips and legends.</Text>
      </Stack>
      <Text
        fontSize="11px"
        lineHeight="1.6"
        color="fg.subtle"
        marginTop={4}
        paddingTop={3}
        borderTopWidth="1px"
        borderColor="border"
      >
        Refusals name the exact JSON pointer they refer to. Warnings inform
        without blocking.
      </Text>
    </Box>
  );
}

export function GovernedSqlChartMode({
  result,
  submittedLabel,
  view = "chart",
  onOpenSpecification,
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

  if (view === "specification") {
    return (
      <HStack
        align="stretch"
        gap={0}
        height="full"
        minHeight="280px"
        data-testid="governed-sql-spec-mode"
      >
        <VStack align="stretch" gap={0} flex="1" minWidth={0}>
          <HStack
            gap={2}
            paddingX={4}
            paddingY={2}
            borderBottomWidth="1px"
            borderColor="border"
          >
            <Text
              fontSize="10.5px"
              fontWeight="700"
              letterSpacing="0.05em"
              textTransform="uppercase"
              color="fg.subtle"
            >
              Chart specification
            </Text>
            <Text fontSize="10.5px" color="fg.subtle">
              Vega-Lite v6 · describes the chart over the returned rows — new
              rows never overwrite your edits
            </Text>
            <Box flex="1" />
            <Button
              size="xs"
              variant="outline"
              onClick={() => setSpecText(starterFor(result))}
              data-testid="vega-spec-reset"
            >
              Reset to the example
            </Button>
          </HStack>
          <Box flex="1" minHeight="240px">
            <VegaLiteSpecEditor
              specText={specText}
              onSpecTextChange={setSpecText}
              errors={errors}
            />
          </Box>
        </VStack>
        <SpecPolicyPanel
          errors={errors}
          summaryLine={`Describes a chart over the ${result.rows.length} returned rows. Edits apply as you type.`}
          onViewChart={undefined}
        />
      </HStack>
    );
  }

  return (
    <VStack align="stretch" gap={3} height="full" data-testid="governed-sql-chart-mode">
      {onOpenSpecification && (
        <HStack justify="flex-end">
          <Button
            size="xs"
            variant="outline"
            onClick={onOpenSpecification}
            data-testid="vega-open-specification"
          >
            Edit specification
          </Button>
        </HStack>
      )}

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
