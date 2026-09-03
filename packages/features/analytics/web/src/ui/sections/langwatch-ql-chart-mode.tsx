/**
 * Chart and Specification: the chart the specification describes, and the
 * editor for the specification itself.
 *
 * This is the whole of what the result pane mounts for both views. It renders
 * the specification text and reports every edit upward; the text itself is the
 * workbench's, because this component is unmounted by a refused query and
 * anything it held would be lost with it. It holds no query hook and cannot
 * cause a request: switching views or editing a chart never re-runs SQL.
 *
 * The query result is registered as a dataset named `query_result`, which is
 * the only name a specification may read here. It is registered by name rather
 * than pasted into the specification so a Reload can push new rows into the
 * running chart instead of rebuilding it.
 *
 * The default export is the lazy-loading boundary's target: everything Vega is
 * reached from here, so no other route loads any of it.
 *
 * @see packages/features/analytics/specs/analytics-lwql-workbench.feature
 */

import { Badge, Box, Button, HStack, Stack, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef } from "react";

import { LWQL_QUERY_RESULT_DATASET } from "@langwatch/analytics-contract/visualization";
import { starterVegaLiteSpecText } from "@langwatch/analytics-contract/visualization";
import {
  parseVegaLiteSpecText,
  validateVegaLiteSpec,
} from "@langwatch/analytics-contract/visualization/validation";
import { isPlainObject } from "@langwatch/analytics-contract/visualization";
import { ALLOWED_VEGA_LITE_TRANSFORMS } from "@langwatch/analytics-contract/visualization";
import type {
  LangWatchQLDatasetColumn,
  VegaLiteValidationResult,
  VegaValidationError,
} from "@langwatch/analytics-contract/visualization";
import type {
  LangWatchQLVegaColorMode,
  LangWatchQLVegaConfig,
} from "@langwatch/analytics-contract/visualization";

import { LangWatchQLChartFailure } from "../elements/langwatch-ql-chart-failure";
import { LangWatchQLVegaLiteChart } from "./langwatch-ql-vega-lite-chart";
import { VegaLiteSpecEditor } from "../elements/vega-lite-spec-editor";

/** The shape of a LangWatchQL result, narrowed to what a chart reads. */
export interface LangWatchQLChartResult {
  readonly columns: readonly LangWatchQLDatasetColumn[];
  readonly rows: readonly Record<string, unknown>[];
}

export interface LangWatchQLChartModeProps {
  readonly result: LangWatchQLChartResult;
  /**
   * How the result is described to a reader who cannot see the chart — the
   * query it came from, when the pane knows it.
   */
  readonly submittedLabel?: string;
  /** Which reading is on screen. The specification state is shared across both. */
  readonly view?: "chart" | "specification";
  /** Switches the result pane to the Specification view. */
  readonly onOpenSpecification?: () => void;
  /**
   * What the member wrote, or `null` while the specification still follows the
   * starter for the result on screen.
   *
   * Held by the owner rather than here, because this component is unmounted by
   * things that have nothing to do with the chart: a refused query takes the
   * whole result body off the page, and a specification stored here would go
   * with it — the member would fix the SQL, run again, and find their chart
   * silently replaced by the example.
   */
  readonly editedSpecText: string | null;
  /** Receives what they wrote, or `null` when they ask for the example back. */
  readonly onEditedSpecTextChange: (text: string | null) => void;
  /** Resolved application theme values supplied by composition. */
  readonly themeConfig: LangWatchQLVegaConfig;
  readonly pinnedConfig: LangWatchQLVegaConfig;
  readonly colorMode: LangWatchQLVegaColorMode;
  /**
   * Hands the owner a way to read the specification on screen, so Save can
   * store it. The same shape the workbench already uses to reach into Monaco:
   * a registration rather than a parse in the caller, because parsing is what
   * keeps the Vega-Lite modules behind the lazy boundary — a workbench that
   * imported the parser would put the whole runtime in the entry chunk
   * (`vegaLazyBoundary.unit.test.ts` is what would notice).
   *
   * Answers the *parsed* specification rather than its text, and `undefined`
   * while the text is not valid JSON. Called with `null` on unmount so nothing
   * keeps reading a dead view.
   */
  readonly registerSpecReader?: (read: (() => Record<string, unknown> | undefined) | null) => void;
}

const starterFor = (result: LangWatchQLChartResult): string =>
  starterVegaLiteSpecText({
    columns: result.columns,
    datasetName: LWQL_QUERY_RESULT_DATASET,
  });

/**
 * What a member can rely on the policy accepting, said next to where they type.
 *
 * A reference, not the rulebook: the validator's refusals each name their own
 * rule and JSON pointer, so this list only has to orient. Every line states a
 * fact the policy modules enforce — marks in `vegaLitePolicy.ts` (image is the
 * one refusal), the dataset name in this file — and the transforms are read
 * straight off the allowlist, which is the only way a member's copy of it
 * cannot fall behind what the policy accepts.
 */
function SpecPolicyPanel({
  errors,
  summaryLine,
}: {
  errors: readonly VegaValidationError[];
  summaryLine: string;
}) {
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
      {errors.length === 0 ? (
        <SpecValidSummary summaryLine={summaryLine} />
      ) : (
        <SpecRefusals errors={errors} />
      )}

      <PolicyAcceptsReference />
    </Box>
  );
}

function SpecValidSummary({ summaryLine }: { summaryLine: string }) {
  return (
    <>
      <Badge size="sm" variant="subtle" colorPalette="green" borderRadius="full" marginBottom={2}>
        Valid
      </Badge>
      <Text fontSize="12px" color="fg.muted" lineHeight="1.6">
        {summaryLine}
      </Text>
    </>
  );
}

function SpecRefusals({ errors }: { errors: readonly VegaValidationError[] }) {
  return (
    <>
      <Badge size="sm" variant="subtle" colorPalette="red" borderRadius="full" marginBottom={2}>
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
  );
}

function PolicyAcceptsReference() {
  return (
    <>
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
        <Text>Reviewed transforms — {ALLOWED_VEGA_LITE_TRANSFORMS.join(", ")}.</Text>
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
        Refusals name the exact JSON pointer they refer to. Warnings inform without blocking.
      </Text>
    </>
  );
}

export function LangWatchQLChartMode({
  result,
  submittedLabel,
  view = "chart",
  onOpenSpecification,
  editedSpecText,
  onEditedSpecTextChange,
  themeConfig,
  pinnedConfig,
  colorMode,
  registerSpecReader,
}: LangWatchQLChartModeProps) {
  // Until the member writes one of their own, the specification is the starter
  // for whatever result is on screen — so a new result with different columns
  // redraws, and a specification they have written never does.
  const starter = useMemo(() => starterFor(result), [result]);
  const specText = editedSpecText ?? starter;

  useRegisteredSpecReader({ specText, registerSpecReader });

  const { datasets, columnsByDataset, parsed, errors } = useSpecValidation({
    result,
    specText,
  });

  if (view === "specification") {
    return (
      <SpecificationView
        specText={specText}
        onSpecTextChange={onEditedSpecTextChange}
        onReset={() => onEditedSpecTextChange(null)}
        errors={errors}
        rowCount={result.rows.length}
      />
    );
  }

  return (
    <VStack align="stretch" gap={3} height="full" data-testid="lwql-chart-mode">
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
        <LangWatchQLVegaLiteChart
          spec={parsed.spec}
          datasets={datasets}
          columnsByDataset={columnsByDataset}
          themeConfig={themeConfig}
          pinnedConfig={pinnedConfig}
          colorMode={colorMode}
          ariaLabel={
            submittedLabel === void 0
              ? "Chart of the query result"
              : `Chart of the result of ${submittedLabel}`
          }
        />
      ) : (
        // Text that does not parse never becomes a candidate specification, so
        // this refusal belongs here rather than to the chart, which is only
        // ever handed something already parsed.
        <LangWatchQLChartFailure errors={parsed.errors} />
      )}
    </VStack>
  );
}

/**
 * Hands the workbench a reader over the current specification text, so Save
 * can capture the member's spec without the editor re-registering on every
 * keystroke. The reader answers `undefined` while the text does not parse to
 * an object — an unparseable spec is not a saveable one.
 */
function useRegisteredSpecReader({
  specText,
  registerSpecReader,
}: {
  specText: string;
  registerSpecReader:
    | ((reader: (() => Record<string, unknown> | undefined) | null) => void)
    | undefined;
}) {
  const specTextRef = useRef(specText);
  specTextRef.current = specText;
  useEffect(() => {
    registerSpecReader?.(() => {
      const candidate = parseVegaLiteSpecText(specTextRef.current);
      if (!candidate.ok) return void 0;
      const { spec } = candidate;
      return isPlainObject(spec) ? spec : void 0;
    });
    return () => registerSpecReader?.(null);
  }, [registerSpecReader]);
}

/** The parse and the policy's verdict, recomputed only when their inputs move. */
function useSpecValidation({
  result,
  specText,
}: {
  result: LangWatchQLChartResult;
  specText: string;
}) {
  const datasets = useMemo(() => ({ [LWQL_QUERY_RESULT_DATASET]: result.rows }), [result.rows]);
  const columnsByDataset = useMemo(
    () => ({ [LWQL_QUERY_RESULT_DATASET]: result.columns }),
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
                [LWQL_QUERY_RESULT_DATASET]: result.rows.length,
              },
            }),
          )
        : parsed.errors,
    [parsed, columnsByDataset, result.rows.length],
  );

  return { datasets, columnsByDataset, parsed, errors };
}

function SpecificationView({
  specText,
  onSpecTextChange,
  onReset,
  errors,
  rowCount,
}: {
  specText: string;
  onSpecTextChange: (text: string) => void;
  onReset: () => void;
  errors: readonly VegaValidationError[];
  rowCount: number;
}) {
  return (
    <HStack align="stretch" gap={0} height="full" minHeight="280px" data-testid="lwql-spec-mode">
      <VStack align="stretch" gap={0} flex="1" minWidth={0}>
        <HStack gap={2} paddingX={4} paddingY={2} borderBottomWidth="1px" borderColor="border">
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
            Vega-Lite v6 · the example follows each new result until you edit — your edits are never
            overwritten
          </Text>
          <Box flex="1" />
          <Button size="xs" variant="outline" onClick={onReset} data-testid="vega-spec-reset">
            Reset to the example
          </Button>
        </HStack>
        <Box flex="1" minHeight="240px">
          <VegaLiteSpecEditor
            specText={specText}
            onSpecTextChange={onSpecTextChange}
            errors={errors}
          />
        </Box>
      </VStack>
      <SpecPolicyPanel
        errors={errors}
        summaryLine={`Describes a chart over the ${rowCount} returned rows. Edits apply as you type.`}
      />
    </HStack>
  );
}

function refusalsOf(result: VegaLiteValidationResult): readonly VegaValidationError[] {
  return result.ok ? [] : result.errors;
}

export default LangWatchQLChartMode;
