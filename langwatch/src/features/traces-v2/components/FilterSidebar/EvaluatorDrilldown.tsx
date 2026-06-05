import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { LiqeQuery } from "liqe";
import type React from "react";
import { useMemo } from "react";
import {
  getFacetValueState,
  getRangeValue,
} from "~/server/app-layer/traces/query-language/queries";
import type { FacetItem } from "./types";

interface EvaluatorDrilldownProps {
  /** The evaluator FacetItem (must carry aggregates). */
  item: FacetItem;
  ast: LiqeQuery;
  toggleFacet: (
    field: string,
    value: string,
    options?: { modifierKey?: boolean },
  ) => void;
  setRange: (field: string, from: string, to: string) => void;
  removeRange: (field: string) => void;
}

const VERDICT_FIELD = "evaluatorVerdict";
const SCORE_FIELD = "evaluatorScore";

interface VerdictPillSpec {
  verdict: "pass" | "fail" | "unknown";
  label: string;
  count: number;
  /** Chakra palette token used for the active state. */
  palette: "green" | "red" | "yellow";
}

/**
 * Inline drilldown rendered under each ACTIVE evaluator row. Shows
 * verdict counts, score range, and label presence — sourced from the
 * `aggregates` field that the discover endpoint already attaches to
 * each evaluator value, so no second round-trip is needed.
 *
 * Verdict pills toggle `evaluatorVerdict:<v>` on the AST; clicking a
 * pill that's already on clears it. Score range is editable through
 * its own min/max inputs (delegates to `setRange("evaluatorScore",
 * …)`). Label row is informational — when an evaluator emits labels,
 * we say so; full per-label filtering lands when the discover wires a
 * label inventory aggregate.
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
  const verdicts = useMemo<VerdictPillSpec[]>(
    () =>
      aggregates
        ? [
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
              verdict: "unknown",
              label: "Errored",
              count: aggregates.erroredCount,
              palette: "yellow",
            },
          ]
        : [],
    [aggregates],
  );

  const activeVerdicts = useMemo(() => {
    const set = new Set<string>();
    for (const v of verdicts) {
      if (getFacetValueState(ast, VERDICT_FIELD, v.verdict) === "include") {
        set.add(v.verdict);
      }
    }
    return set;
  }, [ast, verdicts]);

  const currentScoreRange = useMemo(
    () => getRangeValue(ast, SCORE_FIELD),
    [ast],
  );

  if (!aggregates) return null;
  const totalVerdictCount =
    aggregates.passedCount + aggregates.failedCount + aggregates.erroredCount;

  return (
    // Indented under the row by the same amount the FacetRow text starts
    // (status-dot + gap) so the drilldown reads as visually attached to
    // the row above. Top spacing kept tight so the active row + extras
    // still scan as one unit.
    <Box
      marginLeft="20px"
      marginTop={1}
      marginBottom={1.5}
      paddingX={2}
      paddingY={1.5}
      borderLeftWidth="2px"
      borderLeftColor="border.subtle"
      borderRadius="sm"
      bg="bg.subtle"
    >
      <VStack align="stretch" gap={1.5}>
        {totalVerdictCount > 0 && (
          <VStack align="stretch" gap={1}>
            <Text
              textStyle="2xs"
              color="fg.subtle"
              textTransform="uppercase"
              letterSpacing="0.08em"
              fontWeight="600"
            >
              Verdict
            </Text>
            <HStack gap={1} flexWrap="wrap">
              {verdicts
                .filter((v) => v.count > 0)
                .map((v) => {
                  const active = activeVerdicts.has(v.verdict);
                  return (
                    <Box
                      key={v.verdict}
                      as="button"
                      type="button"
                      display="inline-flex"
                      alignItems="center"
                      gap={1}
                      paddingX={1.5}
                      paddingY={0.5}
                      borderRadius="md"
                      borderWidth="1px"
                      borderColor={
                        active ? `${v.palette}.solid` : `${v.palette}.muted`
                      }
                      bg={active ? `${v.palette}.solid` : `${v.palette}.subtle`}
                      color={
                        active ? `${v.palette}.contrast` : `${v.palette}.fg`
                      }
                      cursor="pointer"
                      transition="background 100ms ease, border-color 100ms ease"
                      _hover={{
                        bg: active
                          ? `${v.palette}.solid`
                          : `${v.palette}.muted`,
                      }}
                      onClick={() => toggleFacet(VERDICT_FIELD, v.verdict)}
                      aria-pressed={active}
                    >
                      <Text textStyle="2xs" fontWeight="600">
                        {v.label}
                      </Text>
                      <Text textStyle="2xs" fontWeight="500" opacity={0.85}>
                        {v.count.toLocaleString()}
                      </Text>
                    </Box>
                  );
                })}
            </HStack>
          </VStack>
        )}
        {aggregates.hasScore && (
          <VStack align="stretch" gap={1}>
            <HStack justify="space-between" align="center" gap={2}>
              <Text
                textStyle="2xs"
                color="fg.subtle"
                textTransform="uppercase"
                letterSpacing="0.08em"
                fontWeight="600"
              >
                Score
              </Text>
              <Text textStyle="2xs" color="fg.muted" fontFamily="mono">
                {formatScore(aggregates.scoreMin)} →{" "}
                {formatScore(aggregates.scoreMax)}
              </Text>
            </HStack>
            <ScoreRangeInput
              min={aggregates.scoreMin ?? 0}
              max={aggregates.scoreMax ?? 1}
              currentFrom={currentScoreRange?.from}
              currentTo={currentScoreRange?.to}
              onChange={(from, to) =>
                setRange(SCORE_FIELD, String(from), String(to))
              }
              onClear={() => removeRange(SCORE_FIELD)}
            />
          </VStack>
        )}
        {aggregates.hasLabel && (
          <Text textStyle="2xs" color="fg.subtle" fontStyle="italic">
            This evaluator emits labels.
          </Text>
        )}
      </VStack>
    </Box>
  );
};

function formatScore(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(2);
}

interface ScoreRangeInputProps {
  min: number;
  max: number;
  currentFrom?: number;
  currentTo?: number;
  onChange: (from: number, to: number) => void;
  onClear: () => void;
}

/**
 * Minimal two-input range editor. Kept simple (no Chakra Slider) so
 * the drilldown reads as a compact inspector rather than a heavy
 * range-tuning UI — the operator usually wants "score ≥ X" or
 * "score = Y" and would rather type than drag. `onClear` runs when
 * both inputs are empty so a freshly opened drilldown can wipe an
 * earlier-applied range with two backspaces.
 */
const ScoreRangeInput: React.FC<ScoreRangeInputProps> = ({
  min,
  max,
  currentFrom,
  currentTo,
  onChange,
  onClear,
}) => {
  const fromValue = currentFrom !== undefined ? String(currentFrom) : "";
  const toValue = currentTo !== undefined ? String(currentTo) : "";
  return (
    <HStack gap={1.5} align="center">
      <Box
        as="input"
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder={String(min)}
        value={fromValue}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const nextFrom = e.target.value;
          const nextTo = toValue;
          if (!nextFrom && !nextTo) {
            onClear();
            return;
          }
          onChange(Number(nextFrom || min), Number(nextTo || max));
        }}
        flex={1}
        minWidth={0}
        height="22px"
        paddingX={1.5}
        borderWidth="1px"
        borderColor="border"
        borderRadius="sm"
        fontSize="2xs"
        fontFamily="mono"
        bg="bg.panel"
        _focus={{
          outline: "none",
          borderColor: "blue.focusRing",
          boxShadow: "0 0 0 1px var(--chakra-colors-blue-focusRing)",
        }}
      />
      <Text textStyle="2xs" color="fg.subtle">
        →
      </Text>
      <Box
        as="input"
        type="number"
        inputMode="decimal"
        step="0.01"
        placeholder={String(max)}
        value={toValue}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const nextFrom = fromValue;
          const nextTo = e.target.value;
          if (!nextFrom && !nextTo) {
            onClear();
            return;
          }
          onChange(Number(nextFrom || min), Number(nextTo || max));
        }}
        flex={1}
        minWidth={0}
        height="22px"
        paddingX={1.5}
        borderWidth="1px"
        borderColor="border"
        borderRadius="sm"
        fontSize="2xs"
        fontFamily="mono"
        bg="bg.panel"
        _focus={{
          outline: "none",
          borderColor: "blue.focusRing",
          boxShadow: "0 0 0 1px var(--chakra-colors-blue-focusRing)",
        }}
      />
    </HStack>
  );
};
