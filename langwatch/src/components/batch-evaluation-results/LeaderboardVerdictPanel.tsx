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

import type { BTLeaderboard } from "./computeBTLeaderboard";
import type {
  CheaperAlternative,
  LeaderboardVerdict,
} from "./computeLeaderboardVerdict";

export type LeaderboardVerdictPanelProps = {
  leaderboard: BTLeaderboard;
  verdict: LeaderboardVerdict;
  cheaperAlternative: CheaperAlternative | null;
  variantNames: Record<string, string>;
  targetColors?: Record<string, string>;
};

const nameOf = (
  variantId: string,
  variantNames: Record<string, string>,
): string => variantNames[variantId] ?? variantId;

const formatCost = (value: number): string =>
  value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;

export function LeaderboardVerdictPanel({
  leaderboard,
  verdict,
  cheaperAlternative,
  variantNames,
  targetColors,
}: LeaderboardVerdictPanelProps) {
  const tied = new Set(verdict.tiedIds);

  return (
    <VStack align="stretch" gap={4}>
      <Headline
        verdict={verdict}
        cheaperAlternative={cheaperAlternative}
        variantNames={variantNames}
      />
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

function Headline({
  verdict,
  cheaperAlternative,
  variantNames,
}: {
  verdict: LeaderboardVerdict;
  cheaperAlternative: CheaperAlternative | null;
  variantNames: Record<string, string>;
}) {
  if (verdict.kind === "no-signal") {
    return (
      <Callout tone="neutral" heading="No ranking yet">
        This run has not resolved enough head-to-head comparisons to place the
        variants in an order. Run it over more rows.
      </Callout>
    );
  }

  if (verdict.kind === "clear-winner") {
    return (
      <Callout
        tone="positive"
        heading={`Ship ${nameOf(verdict.leaderId!, variantNames)}`}
      >
        It scores above every other variant by more than the run&apos;s own
        margin of error, so the ranking is not a coin flip.
      </Callout>
    );
  }

  const tiedNames = verdict.tiedIds
    .map((id) => nameOf(id, variantNames))
    .join(" and ");

  // A tie plus a price difference is not an inconclusive result — it is a
  // decision, just made on cost instead of quality.
  if (cheaperAlternative) {
    return (
      <Callout
        tone="positive"
        heading={`Ship ${nameOf(cheaperAlternative.variantId, variantNames)} — same quality, ${Math.round(
          cheaperAlternative.savingRatio * 100,
        )}% cheaper`}
      >
        {tiedNames} score too closely for this run to separate them, so quality
        is not the deciding factor here. Cost is:{" "}
        {formatCost(cheaperAlternative.cost)} vs{" "}
        {formatCost(cheaperAlternative.leaderCost)} per row.
      </Callout>
    );
  }

  return (
    <Callout tone="caution" heading="Too close to call">
      {tiedNames} score within each other&apos;s margin of error, so this run
      does not establish a winner between them. Decide on cost, latency, or
      simplicity instead — or run more rows to separate them.
    </Callout>
  );
}

const TONES = {
  positive: { bg: "green.subtle", fg: "green.fg", border: "green.emphasized" },
  caution: { bg: "orange.subtle", fg: "orange.fg", border: "orange.emphasized" },
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
  if (entries.length === 0) return null;

  // A bootstrap over very few comparisons can hand back a non-finite bound.
  // One of those anywhere in the set turns min/max into NaN, which makes
  // every position below NaN, which the browser silently drops — collapsing
  // the whole chart to slivers at the left edge. So treat a non-finite
  // interval as no interval at all rather than letting it poison the scale.
  const finiteCI = (
    entry: (typeof entries)[number],
  ): [number, number] | null =>
    entry.scoreCI &&
    Number.isFinite(entry.scoreCI[0]) &&
    Number.isFinite(entry.scoreCI[1])
      ? entry.scoreCI
      : null;

  // Scale to the scores, not to the intervals. Over few comparisons a single
  // interval can be many times wider than the spread of the scores, and
  // scaling to it squashes every marker into the left edge — the reader
  // loses the comparison entirely. Bands instead clip at the track edges,
  // which reads as "the uncertainty runs off the chart" and is the correct
  // impression anyway.
  const scores = entries
    .map((entry) => entry.score)
    .filter((score) => Number.isFinite(score));
  if (scores.length === 0) return null;

  const rawMin = Math.min(...scores);
  const rawMax = Math.max(...scores);
  const pad = (rawMax - rawMin || 1) * 0.1;
  const min = rawMin - pad;
  const max = rawMax + pad;
  const span = max - min || 1;
  const clamp = (value: number) => Math.min(100, Math.max(0, value));
  const pct = (value: number) => clamp(((value - min) / span) * 100);

  return (
    <VStack align="stretch" gap={2}>
      {entries.map((entry) => {
        const isTied = tied.has(entry.variantId);
        const color = targetColors?.[entry.variantId] ?? "rgb(37, 99, 235)";
        const ci = finiteCI(entry);
        return (
          <Box key={entry.variantId}>
            <HStack justify="space-between" marginBottom={1}>
              <HStack gap={2}>
                <Text fontSize="xs" fontWeight="semibold">
                  {nameOf(entry.variantId, variantNames)}
                </Text>
                {showTieShading && isTied ? (
                  <Text fontSize="2xs" color="orange.fg" fontWeight="semibold">
                    tied for first
                  </Text>
                ) : null}
                {entry.degenerate ? (
                  <Text fontSize="2xs" color="fg.muted">
                    not scoreable
                  </Text>
                ) : null}
              </HStack>
              <Text fontSize="2xs" color="fg.muted">
                {entry.winRate === null
                  ? "—"
                  : `${Math.round(entry.winRate * 100)}% win rate`}{" "}
                · {entry.matchups} comparisons
              </Text>
            </HStack>

            <Box
              position="relative"
              height="18px"
              bg="bg.muted"
              borderRadius="sm"
            >
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
          </Box>
        );
      })}
      <Text fontSize="2xs" color="fg.muted">
        Bar marks the score; the shaded band is the range it could plausibly
        be. Overlapping bands mean the run cannot tell those variants apart.
      </Text>
    </VStack>
  );
}
