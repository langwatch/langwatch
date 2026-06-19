import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { LiqeQuery } from "liqe";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { SimpleSlider } from "~/components/ui/slider";
import {
  getFacetValueState,
  getRangeValue,
} from "~/server/app-layer/traces/query-language/queries";
import { RowButton } from "./RowButton";
import { commitRange, RangeEndpointInput, stepForSpan } from "./rangeControls";
import type { FacetItem } from "./types";
import { formatCount } from "./utils";

interface EvaluatorDrilldownProps {
  /** The evaluator FacetItem (must carry aggregates). */
  item: FacetItem;
  ast: LiqeQuery;
  toggleFacet: ({
    field,
    value,
    isModifierKey,
  }: {
    field: string;
    value: string;
    isModifierKey?: boolean;
  }) => void;
  setRange: ({
    field,
    from,
    to,
  }: {
    field: string;
    from: string;
    to: string;
  }) => void;
  removeRange: ({ field }: { field: string }) => void;
}

const VERDICT_FIELD = "evaluatorVerdict";
const SCORE_FIELD = "evaluatorScore";

interface VerdictRowSpec {
  verdict: "pass" | "fail" | "error";
  label: string;
  count: number;
  /** Chakra palette token used for the dot + active state. */
  palette: "green" | "red" | "yellow";
}

/**
 * Inline drilldown rendered under each ACTIVE evaluator row. Shows
 * verdict counts, score range, and label presence — sourced from the
 * `aggregates` field that the discover endpoint already attaches to
 * each evaluator value, so no second round-trip is needed.
 *
 * Visually it speaks the sidebar's own language: verdicts are compact
 * facet-style rows (status dot + label + count, same hover/active
 * treatment as FacetRow), and the score range reuses the
 * RangeSection slider + click-to-edit endpoints rather than a pair of
 * boxed number inputs. No card chrome — just the tree indent guide.
 */
export const EvaluatorDrilldown: React.FC<EvaluatorDrilldownProps> = ({
  item,
  ast,
  toggleFacet,
  setRange,
  removeRange,
}) => {
  // Hooks must run unconditionally; gate everything below by checking
  // `aggregates` *after* the hooks rather than early-returning above
  // them. The render result short-circuits to null when aggregates are
  // missing, but the hook order stays stable.
  const aggregates = item.aggregates;
  const verdicts = useMemo<VerdictRowSpec[]>(
    () => (aggregates ? buildVerdictSpecs(aggregates) : []),
    [aggregates],
  );
  const activeVerdicts = useMemo(
    () => computeActiveVerdicts(ast, verdicts),
    [ast, verdicts],
  );
  const currentScoreRange = useMemo(
    () => getRangeValue(ast, SCORE_FIELD),
    [ast],
  );

  if (!aggregates) return null;
  const visibleVerdicts = verdicts.filter((v) => v.count > 0);
  const maxVerdictCount = Math.max(...visibleVerdicts.map((v) => v.count), 0);

  return (
    // Indented under the row by the same amount the FacetRow text starts
    // (status-dot + gap) so the drilldown reads as visually attached to
    // the row above; a hairline indent guide replaces the old card box.
    <Box
      marginLeft="20px"
      marginTop={0.5}
      marginBottom={1}
      paddingLeft={2}
      borderLeftWidth="1px"
      borderLeftColor="border.muted"
      data-spotlight="evaluator-drilldown"
    >
      <VStack align="stretch" gap={1}>
        {visibleVerdicts.length > 0 && (
          <VStack align="stretch" gap={0}>
            {visibleVerdicts.map((v) => (
              <VerdictRow
                key={v.verdict}
                spec={v}
                maxCount={maxVerdictCount}
                active={activeVerdicts.has(v.verdict)}
                onClick={() =>
                  toggleFacet({ field: VERDICT_FIELD, value: v.verdict })
                }
              />
            ))}
          </VStack>
        )}
        {aggregates.hasScore && (
          <ScoreRangeControl
            scoreMin={aggregates.scoreMin}
            scoreMax={aggregates.scoreMax}
            currentFrom={currentScoreRange?.from}
            currentTo={currentScoreRange?.to}
            onChange={(from, to) =>
              setRange({
                field: SCORE_FIELD,
                from: String(from),
                to: String(to),
              })
            }
            onClear={() => removeRange({ field: SCORE_FIELD })}
          />
        )}
        {aggregates.hasLabel && (
          <Text textStyle="2xs" color="fg.subtle" paddingX={1.5}>
            Emits labels
          </Text>
        )}
      </VStack>
    </Box>
  );
};

function buildVerdictSpecs(aggregates: {
  passedCount: number;
  failedCount: number;
  erroredCount: number;
}): VerdictRowSpec[] {
  return [
    {
      verdict: "pass",
      label: "Passed",
      count: aggregates.passedCount,
      palette: "green",
    },
    {
      verdict: "fail",
      label: "Failed",
      count: aggregates.failedCount,
      palette: "red",
    },
    {
      // Matches the facet expression's `Status = 'error'` branch — the
      // count below is countIf(Status = 'error'), so the row must filter
      // by the same bucket (it previously emitted 'unknown', which is the
      // Passed-is-null-but-not-errored bucket).
      verdict: "error",
      label: "Errored",
      count: aggregates.erroredCount,
      palette: "yellow",
    },
  ];
}

function computeActiveVerdicts(
  ast: LiqeQuery,
  verdicts: VerdictRowSpec[],
): Set<string> {
  const set = new Set<string>();
  for (const v of verdicts) {
    if (getFacetValueState(ast, VERDICT_FIELD, v.verdict) === "include") {
      set.add(v.verdict);
    }
  }
  return set;
}

const MIN_VISIBLE_FILL_PCT = 4;

/**
 * Compact verdict row in FacetRow's visual idiom: coloured status dot,
 * label, right-aligned count, a thin proportional fill bar along the
 * bottom edge, subtle-bg + right accent bar when active.
 */
const VerdictRow: React.FC<{
  spec: VerdictRowSpec;
  maxCount: number;
  active: boolean;
  onClick: () => void;
}> = ({ spec, maxCount, active, onClick }) => {
  const fillPct =
    maxCount > 0
      ? Math.max((spec.count / maxCount) * 100, MIN_VISIBLE_FILL_PCT)
      : 0;
  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={active}
      aria-label={`${spec.label} — ${active ? "included" : "click to include"}`}
      position="relative"
      width="full"
      paddingY={0.5}
      paddingLeft={1.5}
      paddingRight={0}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background={active ? `${spec.palette}.subtle` : "transparent"}
      borderWidth={0}
      onClick={onClick}
      transition="background 120ms ease"
      _hover={{
        background: active ? `${spec.palette}.subtle` : "bg.muted",
      }}
      _focusVisible={{
        outline: "2px solid",
        outlineColor: "blue.focusRing",
        outlineOffset: "-2px",
      }}
    >
      <Box
        position="absolute"
        bottom={0}
        left={0}
        width={`${fillPct}%`}
        height="2px"
        bg={`${spec.palette}.solid`}
        opacity={0.55}
        pointerEvents="none"
      />
      {active && (
        <Box
          position="absolute"
          top={0}
          right={0}
          bottom={0}
          width="2px"
          bg={`${spec.palette}.solid`}
          pointerEvents="none"
        />
      )}
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        <Box
          width="6px"
          height="6px"
          borderRadius="full"
          bg={`${spec.palette}.solid`}
          flexShrink={0}
        />
        <Text
          textStyle="2xs"
          fontWeight={active ? "600" : "500"}
          truncate
          flex={1}
          minWidth={0}
          color={active ? "fg" : "fg.muted"}
        >
          {spec.label}
        </Text>
        <Text
          textStyle="2xs"
          color="fg.subtle"
          mr={2}
          fontWeight={active ? "600" : "400"}
          flexShrink={0}
        >
          {formatCount(spec.count)}
        </Text>
      </HStack>
    </RowButton>
  );
};

/**
 * Score range in RangeSection's idiom: slider + click-to-edit endpoint
 * values. Commits on drag end / typed commit; selecting the full range
 * clears the filter so the drilldown never pins a no-op range into the
 * query string.
 */
const ScoreRangeControl: React.FC<{
  scoreMin: number | null;
  scoreMax: number | null;
  currentFrom?: number;
  currentTo?: number;
  onChange: (from: number, to: number) => void;
  onClear: () => void;
}> = ({ scoreMin, scoreMax, currentFrom, currentTo, onChange, onClear }) => {
  const min = scoreMin ?? 0;
  const max = scoreMax ?? 1;
  const span = max - min || 1;
  const isActive = currentFrom !== undefined || currentTo !== undefined;
  const [localValue, setLocalValue] = useState<[number, number]>([
    currentFrom ?? min,
    currentTo ?? max,
  ]);

  useEffect(() => {
    setLocalValue([currentFrom ?? min, currentTo ?? max]);
  }, [currentFrom, currentTo, min, max]);

  const commit = (rawFrom: number, rawTo: number) => {
    const normalized = commitRange({
      rawFrom,
      rawTo,
      min,
      max,
      span,
      onChange,
      onClear,
    });
    if (normalized) setLocalValue(normalized);
  };

  if (max <= min) {
    return (
      <Text textStyle="2xs" color="fg.subtle" paddingX={1.5} fontFamily="mono">
        score {formatScore(min)}
      </Text>
    );
  }

  return (
    <VStack align="stretch" gap={0} paddingX={1.5}>
      <SimpleSlider
        size="sm"
        min={min}
        max={max}
        step={stepForSpan(span)}
        value={localValue}
        onValueChange={(d) => {
          const lo = d.value[0];
          const hi = d.value[1];
          if (lo === undefined || hi === undefined) return;
          setLocalValue([lo, hi]);
        }}
        onValueChangeEnd={(d) => {
          const lo = d.value[0];
          const hi = d.value[1];
          if (lo === undefined || hi === undefined) return;
          commit(lo, hi);
        }}
        colorPalette={isActive ? "blue" : "gray"}
      />
      <HStack justify="space-between" gap={2}>
        <RangeEndpointInput
          value={localValue[0]}
          format={formatScore}
          ariaLabel="Score minimum"
          onCommit={(n) => commit(n, localValue[1])}
        />
        <RangeEndpointInput
          value={localValue[1]}
          format={formatScore}
          ariaLabel="Score maximum"
          align="right"
          onCommit={(n) => commit(localValue[0], n)}
        />
      </HStack>
    </VStack>
  );
};

function formatScore(value: number): string {
  if (Number.isNaN(value)) return "—";
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2);
}
