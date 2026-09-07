import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { LiqeQuery } from "liqe";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { SimpleSlider } from "~/components/ui/slider";
import {
  EVALUATOR_LABEL_FIELD,
  EVALUATOR_VERDICT_FIELD,
  readEvaluatorGroupFromAst,
} from "~/server/app-layer/traces/query-language/evaluatorGroup";
import { RowButton } from "./RowButton";
import { commitRange, RangeEndpointInput, stepForSpan } from "./rangeControls";
import type { FacetItem } from "./types";
import { formatCount } from "./utils";

interface EvaluatorDrilldownProps {
  /** The evaluator FacetItem (must carry aggregates). */
  item: FacetItem;
  ast: LiqeQuery;
  /**
   * Toggle a verdict / label sub-condition for THIS evaluator. The caller
   * binds it to `item.value`, wrapping the result in the evaluator's
   * parenthesised group — so the verdict / label scopes to one evaluation.
   */
  toggleSubFilter: ({ field, value }: { field: string; value: string }) => void;
  /** Set the score range inside this evaluator's group. */
  setScoreRange: ({ from, to }: { from: string; to: string }) => void;
  /** Clear just the score range from this evaluator's group. */
  removeScoreRange: () => void;
}

const VERDICT_FIELD = EVALUATOR_VERDICT_FIELD;
const LABEL_FIELD = EVALUATOR_LABEL_FIELD;

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
  toggleSubFilter,
  setScoreRange,
  removeScoreRange,
}) => {
  // Hooks must run unconditionally; gate everything below by checking
  // `aggregates` *after* the hooks rather than early-returning above
  // them. The render result short-circuits to null when aggregates are
  // missing, but the hook order stays stable.
  const aggregates = item.aggregates;
  // Read THIS evaluator's group state out of the AST — verdict / label /
  // score active state is scoped to `(evaluator:<id> AND …)`, so two active
  // evaluators that share a verdict value don't alias each other.
  const group = useMemo(
    () => readEvaluatorGroupFromAst(ast, item.value),
    [ast, item.value],
  );
  const verdicts = useMemo<VerdictRowSpec[]>(
    () => (aggregates ? buildVerdictSpecs(aggregates) : []),
    [aggregates],
  );
  const activeVerdicts = useMemo(
    () => computeActiveSubValues(group, VERDICT_FIELD),
    [group],
  );
  const activeLabels = useMemo(
    () => computeActiveSubValues(group, LABEL_FIELD),
    [group],
  );
  const currentScoreRange = group.score;

  if (!aggregates) return null;
  const visibleVerdicts = verdicts.filter((v) => v.count > 0);
  const maxVerdictCount = Math.max(...visibleVerdicts.map((v) => v.count), 0);

  const labelValues = aggregates.labelValues ?? [];
  const visibleLabels = labelValues.filter((l) => l.count > 0);
  const maxLabelCount = Math.max(...visibleLabels.map((l) => l.count), 0);

  // The "pass/fail rows AND a score slider" confusion comes from
  // evaluators that emit a binary 0/1 score alongside `passed` — the
  // slider over [0,1] just re-expresses the verdict the pill rows
  // already show. Suppress the score control in that exact case: two
  // distinct score values spanning [0, 1]. Genuine score ranges keep it,
  // and an evaluator whose scores only *happen* to be constant in this
  // window (a single distinct value) still renders its mono value line
  // via ScoreRangeControl. `hasScore` alone fired for any non-null
  // score, which is what surfaced the redundant slider.
  const scoreMirrorsVerdict =
    aggregates.distinctScores === 2 &&
    aggregates.scoreMin === 0 &&
    aggregates.scoreMax === 1;
  const hasMeaningfulScore = aggregates.hasScore && !scoreMirrorsVerdict;

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
              <ValueRow
                key={v.verdict}
                label={v.label}
                count={v.count}
                palette={v.palette}
                showDot
                maxCount={maxVerdictCount}
                active={activeVerdicts.has(v.verdict)}
                onClick={() =>
                  toggleSubFilter({ field: VERDICT_FIELD, value: v.verdict })
                }
              />
            ))}
          </VStack>
        )}
        {hasMeaningfulScore && (
          <ScoreRangeControl
            scoreMin={aggregates.scoreMin}
            scoreMax={aggregates.scoreMax}
            currentFrom={currentScoreRange?.from}
            currentTo={currentScoreRange?.to}
            onChange={(from, to) =>
              setScoreRange({ from: String(from), to: String(to) })
            }
            onClear={removeScoreRange}
          />
        )}
        {visibleLabels.length > 0 && (
          <VStack align="stretch" gap={0}>
            {visibleLabels.map((l) => (
              <ValueRow
                key={l.value}
                label={l.value}
                count={l.count}
                palette="purple"
                maxCount={maxLabelCount}
                active={activeLabels.has(l.value)}
                onClick={() =>
                  toggleSubFilter({ field: LABEL_FIELD, value: l.value })
                }
              />
            ))}
          </VStack>
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

/**
 * Values of `field` (verdict or label) that are actively INCLUDED in this
 * evaluator's group. Excluded (negated) sub-conditions aren't surfaced as
 * active — the drilldown rows only model include-state, matching the previous
 * behaviour.
 */
function computeActiveSubValues(
  group: { categorical: { field: string; value: string; negated: boolean }[] },
  field: string,
): Set<string> {
  const set = new Set<string>();
  for (const sub of group.categorical) {
    if (sub.field === field && !sub.negated) set.add(sub.value);
  }
  return set;
}

const MIN_VISIBLE_FILL_PCT = 4;

/**
 * Compact, clickable filter row in FacetRow's visual idiom: optional coloured
 * status dot, label, right-aligned count, a thin proportional fill bar along
 * the bottom edge, subtle-bg + right accent bar when active. Shared by the
 * verdict pills (with a status dot) and the emitted-label rows (no dot —
 * labels are free-form strings, not a closed traffic-light enum).
 */
const ValueRow: React.FC<{
  label: string;
  count: number;
  /** Chakra palette token for the dot + active state (green / red / purple…). */
  palette: string;
  maxCount: number;
  active: boolean;
  onClick: () => void;
  showDot?: boolean;
}> = ({
  label,
  count,
  palette,
  maxCount,
  active,
  onClick,
  showDot = false,
}) => {
  const fillPct =
    maxCount > 0 ? Math.max((count / maxCount) * 100, MIN_VISIBLE_FILL_PCT) : 0;
  return (
    <RowButton
      type="button"
      role="checkbox"
      aria-checked={active}
      aria-label={`${label} — ${active ? "included" : "click to include"}`}
      position="relative"
      width="full"
      paddingY={0.5}
      paddingLeft={1.5}
      paddingRight={0}
      cursor="pointer"
      textAlign="left"
      borderRadius="sm"
      overflow="hidden"
      background={active ? `${palette}.subtle` : "transparent"}
      borderWidth={0}
      onClick={onClick}
      transition="background 120ms ease"
      _hover={{
        background: active ? `${palette}.subtle` : "bg.muted",
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
        bg={`${palette}.solid`}
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
          bg={`${palette}.solid`}
          pointerEvents="none"
        />
      )}
      <HStack gap={1.5} position="relative" minWidth={0} zIndex={1}>
        {showDot && (
          <Box
            width="6px"
            height="6px"
            borderRadius="full"
            bg={`${palette}.solid`}
            flexShrink={0}
          />
        )}
        <Text
          textStyle="2xs"
          fontWeight={active ? "600" : "500"}
          truncate
          flex={1}
          minWidth={0}
          color={active ? "fg" : "fg.muted"}
        >
          {label}
        </Text>
        <Text
          textStyle="2xs"
          color="fg.subtle"
          mr={2}
          fontWeight={active ? "600" : "400"}
          flexShrink={0}
        >
          {formatCount(count)}
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
