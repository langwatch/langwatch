/**
 * LeaderboardVerdictPanel — the answer, stated in one sentence, above the
 * evidence for it.
 *
 * A ranked table makes the reader do the statistics: compare "1.42 ± 0.18"
 * against "1.31 ± 0.22", notice the intervals overlap, and conclude the run
 * did not actually separate them. Most readers instead take the top row as
 * the winner. So the conclusion is computed and written out, and the bars
 * below exist to show WHY it holds — overlapping whiskers make a tie
 * visible at a glance in a way two ± figures never do.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import type { BTLeaderboard } from "../../../model/batch-evaluation-results.bt-leaderboard";
import type { CheaperAlternative, LeaderboardVerdict } from "../batch-evaluation-results.verdict";
import { formatLeaderboardHeadline } from "../batch-evaluation-results.headline";

export type LeaderboardVerdictPanelProps = {
  leaderboard: BTLeaderboard;
  verdict: LeaderboardVerdict;
  cheaperAlternative: CheaperAlternative | null;
  variantNames: Record<string, string>;
  targetColors?: Record<string, string>;
};

const nameOf = (variantId: string, variantNames: Record<string, string>): string =>
  variantNames[variantId] ?? variantId;

/**
 * The horizontal scale for the score bars: which scores are allowed to set the
 * axis bounds, and how a value maps onto 0-100%.
 *
 * A named function rather than an inline filter chain because the rule it
 * encodes has already been lost once in a refactor. Two exclusions carry the
 * whole behaviour:
 *
 *  - **Scale to the scores, not the intervals.** Over few comparisons a single
 *    interval can be many times wider than the spread of the scores; scaling
 *    to it squashes every marker into one edge and the reader loses the
 *    comparison entirely. Bands clip at the track edges instead, which reads
 *    as "the uncertainty runs off the chart" — the correct impression.
 *  - **Degenerate entries do not set the bounds.** A variant that never won or
 *    never lost has no meaningful MLE score and in practice lands on an
 *    extreme sink value. Letting it into min/max stretches the axis around a
 *    number that means nothing. Its bar is still drawn and still labelled
 *    "not scoreable"; it just does not get a vote on the scale.
 *
 * Returns null when nothing is scoreable, which the caller renders as no bars
 * rather than as a degenerate axis.
 */
export const computeScoreBarScale = (
  entries: BTLeaderboard["entries"],
): { min: number; max: number; pct: (value: number) => number } | null => {
  const scores = entries
    .filter((entry) => !entry.isDegenerate)
    .map((entry) => entry.score)
    .filter((score) => Number.isFinite(score));
  if (scores.length === 0) return null;

  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  const pad = (rawMax - rawMin || 1) * 0.1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min || 1;

  return {
    min,
    max,
    pct: (value: number) => Math.min(100, Math.max(0, ((value - min) / span) * 100)),
  };
};

/**
 * Which edges of an interval run past the chart.
 *
 * The scale is built from the scores, so a wide interval routinely extends
 * beyond both bounds and `pct` clamps it to the track. Clamping alone is a
 * lie by omission: a band cut off at the edge draws exactly like a band that
 * genuinely ends there, which makes the uncertainty look SMALLER than it is —
 * the one misreading this chart exists to prevent. The caller fades the
 * clipped edge so "runs off the chart" and "stops here" stop looking alike.
 */
export const computeBandClipping = ({
  ci,
  min,
  max,
}: {
  ci: [number, number];
  min: number;
  max: number;
}): { start: boolean; end: boolean } => ({
  start: ci[0] < min,
  end: ci[1] > max,
});

/** CSS mask that fades whichever edges were clipped. Undefined when neither is. */
export const clippedBandMask = ({
  start,
  end,
}: {
  start: boolean;
  end: boolean;
}): string | undefined => {
  if (start && end)
    return "linear-gradient(to right, transparent 0%, #000 14%, #000 86%, transparent 100%)";
  if (start) return "linear-gradient(to right, transparent 0%, #000 14%)";
  if (end) return "linear-gradient(to left, transparent 0%, #000 14%)";
  return undefined;
};

export function LeaderboardVerdictPanel({
  leaderboard,
  verdict,
  cheaperAlternative,
  variantNames,
  targetColors,
}: LeaderboardVerdictPanelProps) {
  const tied = new Set(verdict.tiedIds);

  // Computed, not generated, and shared verbatim with the compact card.
  // Everything this sentence says is already a deterministic function of the
  // scores and costs, so writing it with a model would buy fluency at the
  // price of the one thing the leaderboard is for: not naming a winner the
  // data cannot support.
  const headline = formatLeaderboardHeadline({
    verdict,
    cheaperAlternative,
    variantNames,
  });

  return (
    <VStack align="stretch" gap={4}>
      <Callout tone={headline.tone} heading={headline.heading}>
        {headline.detail}
      </Callout>
      <ScoreBars
        leaderboard={leaderboard}
        variantNames={variantNames}
        targetColors={targetColors}
        tied={tied}
        showTieShading={verdict.kind === "tie-at-top"}
      />
    </VStack>
  );
}

const TONES = {
  positive: { bg: "green.subtle", fg: "green.fg", border: "green.emphasized" },
  caution: {
    bg: "orange.subtle",
    fg: "orange.fg",
    border: "orange.emphasized",
  },
  neutral: { bg: "bg.muted", fg: "fg", border: "border.emphasized" },
} as const;

function Callout({
  tone,
  heading,
  children,
}: {
  tone: keyof typeof TONES;
  heading: string;
  children: React.ReactNode;
}) {
  const palette = TONES[tone];
  return (
    <Box
      bg={palette.bg}
      borderStartWidth="3px"
      borderStartColor={palette.border}
      borderRadius="md"
      padding={3}
    >
      <Text fontSize="md" fontWeight="bold" color={palette.fg}>
        {heading}
      </Text>
      <Text fontSize="xs" color="fg.muted" marginTop={1}>
        {children}
      </Text>
    </Box>
  );
}

/**
 * A bootstrap over very few comparisons can hand back a non-finite bound. One
 * of those anywhere in the set turns min/max into NaN, which makes every
 * position below NaN, which the browser silently drops — collapsing the whole
 * chart to slivers at the left edge. So treat a non-finite interval as no
 * interval at all rather than letting it poison the scale.
 */
const finiteCI = (entry: BTLeaderboard["entries"][number]): [number, number] | null =>
  entry.scoreCI && Number.isFinite(entry.scoreCI[0]) && Number.isFinite(entry.scoreCI[1])
    ? entry.scoreCI
    : null;

/** The variant's name, why it is or is not rankable, and its win record. */
function ScoreBarCaption({
  entry,
  label,
  tieLabel,
}: {
  entry: BTLeaderboard["entries"][number];
  label: string;
  tieLabel: boolean;
}) {
  return (
    <HStack justify="space-between" marginBottom={1}>
      <HStack gap={2}>
        <Text fontSize="xs" fontWeight="semibold">
          {label}
        </Text>
        {tieLabel ? (
          <Text fontSize="2xs" color="orange.fg" fontWeight="semibold">
            tied for first
          </Text>
        ) : null}
        {entry.isDegenerate ? (
          <Text fontSize="2xs" color="fg.muted">
            not scoreable
          </Text>
        ) : null}
      </HStack>
      <Text fontSize="2xs" color="fg.muted">
        {entry.winRate === null ? "—" : `${Math.round(entry.winRate * 100)}% win rate`} ·{" "}
        {entry.matchups} comparisons
      </Text>
    </HStack>
  );
}

/** The score marker, with the 95% interval drawn behind it as a band. */
function ScoreBarTrack({
  entry,
  color,
  scale,
}: {
  entry: BTLeaderboard["entries"][number];
  color: string;
  scale: NonNullable<ReturnType<typeof computeScoreBarScale>>;
}) {
  const { pct, min, max } = scale;
  const ci = finiteCI(entry);
  const clip = ci ? computeBandClipping({ ci, min, max }) : null;
  const mask = clip ? clippedBandMask(clip) : undefined;

  return (
    <Box position="relative" height="18px" bg="bg.muted" borderRadius="sm">
      {/* 95% interval — the whisker */}
      {ci ? (
        <Box
          position="absolute"
          top="5px"
          bottom="5px"
          insetStart={`${pct(ci[0])}%`}
          width={`${Math.max(1, pct(ci[1]) - pct(ci[0]))}%`}
          bg={color}
          opacity={0.25}
          borderRadius="sm"
          borderStartRadius={clip?.start ? 0 : undefined}
          borderEndRadius={clip?.end ? 0 : undefined}
          style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
        />
      ) : null}
      {/* point estimate */}
      <Box
        position="absolute"
        top={0}
        bottom={0}
        insetStart={`${pct(entry.score)}%`}
        width="3px"
        bg={color}
        borderRadius="full"
      />
    </Box>
  );
}

/**
 * One bar per variant with its 95% interval drawn as a whisker.
 *
 * The whisker is the point: two bars of visibly different length whose
 * whiskers overlap is the exact picture of "looks better, isn't provably
 * better", and it takes no statistical training to read.
 */
function ScoreBars({
  leaderboard,
  variantNames,
  targetColors,
  tied,
  showTieShading,
}: {
  leaderboard: BTLeaderboard;
  variantNames: Record<string, string>;
  targetColors?: Record<string, string>;
  tied: Set<string>;
  showTieShading: boolean;
}) {
  const entries = leaderboard.entries;
  const scale = entries.length > 0 ? computeScoreBarScale(entries) : null;
  if (!scale) return null;

  return (
    <VStack align="stretch" gap={2}>
      {entries.map((entry) => (
        <Box key={entry.variantId}>
          <ScoreBarCaption
            entry={entry}
            label={nameOf(entry.variantId, variantNames)}
            tieLabel={showTieShading && tied.has(entry.variantId)}
          />
          <ScoreBarTrack
            entry={entry}
            color={targetColors?.[entry.variantId] ?? "rgb(37, 99, 235)"}
            scale={scale}
          />
        </Box>
      ))}
      {/*
        This used to read "where two bands overlap, this run did not separate
        those variants". That was the rule when separation compared these two
        bands; it is now decided on the interval of the DIFFERENCE between two
        scores, which is tighter than either band because both move together
        across resamples. Overlapping bands are therefore routinely separated
        — on a four-variant run this caption sat a few lines above a count
        that contradicted it. The bands still show how well each score is
        pinned down, which is what they are for; they just are not the test.
      */}
      <Text fontSize="2xs" color="fg.muted">
        Bar marks the score, the shaded band the range it could plausibly be. Two bands overlapping
        does not by itself mean the run failed to separate them — that is judged on the gap between
        the two scores, which is pinned down better than either score alone
        {showTieShading
          ? ", and “tied for first” marks the variants it could not separate from the top scorer"
          : ""}
        . A faded edge means the band continues past the chart.
      </Text>
    </VStack>
  );
}
