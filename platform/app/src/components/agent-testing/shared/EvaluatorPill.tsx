/**
 * One evaluator's reading, as a pill: its name, then what it said.
 *
 * A pass or fail evaluator on one scenario reads Pass or Fail, with a dot in
 * the colour of that verdict. Over a whole run the same evaluator reads a pass
 * rate, on the same colour scale as the pass block beside it. A score reads
 * its number in the plain text colour and carries no dot: which direction of
 * a score is the good one is not known here, so colouring it would say
 * something that cannot be known. An evaluator that had nothing to read is
 * muted and says so.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { formatScore } from "~/components/shared/formatters";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type {
  EvaluatorSummary,
  RunEvaluation,
} from "../results/evaluation-summaries";
import { FG_MUTED } from "./design";
import {
  formatPassRate,
  PASS_RATE_AMBER_COLOR,
  passRateColor,
} from "./pass-rate-color";

/** What a pill reads: one verdict, a rate over many, a number, or nothing. */
export type EvaluatorPillReading =
  | { kind: "verdict"; passed: boolean }
  | { kind: "rate"; passRate: number }
  | { kind: "score"; score: number }
  | { kind: "skipped" }
  | { kind: "error" };

/** The reading of one result on one scenario run. */
export function readingOfEvaluation(
  evaluation: RunEvaluation,
): EvaluatorPillReading {
  switch (evaluation.status) {
    case "passed":
      return { kind: "verdict", passed: true };
    case "failed":
      return { kind: "verdict", passed: false };
    case "scored":
      return { kind: "score", score: evaluation.score ?? 0 };
    case "error":
      return { kind: "error" };
    case "skipped":
      return { kind: "skipped" };
  }
}

/** The reading of one evaluator over every scenario run of a run. */
export function readingOfSummary(
  summary: EvaluatorSummary,
): EvaluatorPillReading {
  if (summary.kind === "passfail" && summary.passRate !== null) {
    return { kind: "rate", passRate: summary.passRate };
  }
  if (summary.kind === "score" && summary.meanScore !== null) {
    return { kind: "score", score: summary.meanScore };
  }
  return { kind: "skipped" };
}

const PASSED_COLOR =
  SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.SUCCESS].fgColor;
const FAILED_COLOR =
  SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.FAILED].fgColor;

/**
 * How big the pill is drawn. "md" matches the 32px pass block of a header
 * line, so the two read as peers; "sm" fits a table cell.
 */
const PILL_SIZES = {
  sm: {
    height: undefined,
    paddingX: 2,
    paddingY: 0.5,
    fontSize: "11px",
    dot: "6px",
  },
  md: {
    height: "32px",
    paddingX: 2.5,
    paddingY: 0,
    fontSize: "12px",
    dot: "8px",
  },
} as const;

/** The word or the number a reading shows, and the colour of its dot. */
function readingText(reading: EvaluatorPillReading): {
  text: string;
  dotColor: string | null;
  muted: boolean;
} {
  switch (reading.kind) {
    case "verdict":
      return {
        text: reading.passed ? "Pass" : "Fail",
        dotColor: reading.passed ? PASSED_COLOR : FAILED_COLOR,
        muted: false,
      };
    case "rate":
      return {
        text: formatPassRate(reading.passRate),
        dotColor: passRateColor(reading.passRate),
        muted: false,
      };
    case "score":
      return { text: formatScore(reading.score), dotColor: null, muted: false };
    case "error":
      return { text: "Error", dotColor: PASS_RATE_AMBER_COLOR, muted: false };
    case "skipped":
      return { text: "Skipped", dotColor: null, muted: true };
  }
}

/** What the hover says about a reading. */
function pillTitle({
  name,
  reading,
}: {
  name: string;
  reading: EvaluatorPillReading;
}): string {
  switch (reading.kind) {
    case "skipped":
      return `${name}: nothing to read on this scenario`;
    case "error":
      return `${name}: the evaluator could not run`;
    case "rate":
      return `${name}: pass rate over the run`;
    case "score":
      return `${name}: score`;
    case "verdict":
      return name;
  }
}

export type EvaluatorPillProps = {
  evaluatorId: string;
  name: string;
  reading: EvaluatorPillReading;
  size?: keyof typeof PILL_SIZES;
};

export function EvaluatorPill({
  evaluatorId,
  name,
  reading,
  size = "sm",
}: EvaluatorPillProps) {
  const sizes = PILL_SIZES[size];
  const { text, dotColor, muted } = readingText(reading);
  const title = pillTitle({ name, reading });

  return (
    <HStack
      gap={size === "md" ? 2 : 1.5}
      height={sizes.height}
      paddingX={sizes.paddingX}
      paddingY={sizes.paddingY}
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      background="bg"
      whiteSpace="nowrap"
      opacity={muted ? 0.7 : 1}
      title={title}
      data-testid={`evaluator-pill-${evaluatorId}`}
      data-reading={reading.kind}
    >
      <Text
        as="span"
        fontSize={sizes.fontSize}
        fontWeight="medium"
        color={FG_MUTED}
        truncate
        maxWidth="180px"
      >
        {name}
      </Text>
      <HStack gap={1} flexShrink={0}>
        {dotColor ? (
          <Box
            width={sizes.dot}
            height={sizes.dot}
            borderRadius="full"
            backgroundColor={dotColor}
            flexShrink={0}
            data-testid="evaluator-pill-dot"
          />
        ) : null}
        <Text
          as="span"
          fontSize={sizes.fontSize}
          fontWeight="semibold"
          fontVariantNumeric="tabular-nums"
          color={muted ? FG_MUTED : "fg"}
        >
          {text}
        </Text>
      </HStack>
    </HStack>
  );
}
