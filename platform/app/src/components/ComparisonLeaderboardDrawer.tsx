/**
 * ComparisonLeaderboardDrawer - full Bradley-Terry leaderboard view (#5103).
 *
 * Structured as three questions in the order a reader actually has them:
 * what should I ship, can I believe that, and what do I do about it. The
 * first step alone is meant to be a defensible answer — someone who reads
 * nothing else should still leave with the right variant. The detail that
 * used to lead (a sortable score table) now sits under step 3, because it
 * answers "why" for people who want it rather than "what" for everyone.
 *
 * Opened from ComparisonLeaderboardChart's expand affordance. Data
 * (`column`, `rows`, `targetColors`) is passed via drawer complexProps
 * rather than refetched — it's the same data already loaded on the results
 * page, and these can be large enough that URL serialization would be the
 * wrong tool.
 *
 * Which means the drawer has two mount paths, not one. `CurrentDrawer` also
 * mounts it straight from the query string, where complexProps are gone and
 * only `evaluatorId` survives; that path gets `LeaderboardNeedsResultsPage`.
 * Everything below the gate in `ComparisonLeaderboardDrawer` may assume the
 * data is present, and nothing above it may touch the data.
 */
import { Box, Separator, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import {
  computeJudgeIndependence,
  computeVerbosityProfile,
} from "@langwatch/experiment-web";
import {
  computeLeaderboardVerdict,
  findCheaperTiedAlternative,
} from "@langwatch/experiment-web";
import { computeSampleAdequacy } from "@langwatch/experiment-web";
import { LeaderboardStep } from "./batch-evaluation-results/LeaderboardStep";
import {
  buildTrustChecks,
  LeaderboardTrustPanel,
} from "./batch-evaluation-results/LeaderboardTrustPanel";
import { LeaderboardVerdictPanel } from "./batch-evaluation-results/LeaderboardVerdictPanel";
import {
  DEFAULT_WARN_THRESHOLD,
  PairwiseLeaderboard,
} from "./batch-evaluation-results/PairwiseLeaderboard";
import { ParetoScatterChart } from "./batch-evaluation-results/ParetoScatterChart";
import { TradeoffSummaryLine } from "./batch-evaluation-results/TradeoffSummaryLine";
import type { BatchComparisonColumn, BatchResultRow } from "@langwatch/experiment-web";
import { useBTLeaderboard } from "@langwatch/experiment-web";
import { useShowComparisonLeaderboard } from "./batch-evaluation-results/useShowComparisonLeaderboard";
import { useVariantMetrics } from "@langwatch/experiment-web";
import { Drawer } from "./ui/drawer";

export type ComparisonLeaderboardDrawerProps = {
  /** Which comparison this drawer is for. The only URL-serializable prop. */
  evaluatorId: string;
  /**
   * The run's data, handed over in memory by the results page.
   *
   * OPTIONAL because it cannot survive the URL. `CurrentDrawer` mounts this
   * component from the query string on a reload or a pasted link, and then
   * only `evaluatorId` arrives — everything below is undefined. Typing these
   * as required described a guarantee the drawer does not have, and the code
   * dereferenced them on the strength of it.
   */
  column?: BatchComparisonColumn;
  rows?: BatchResultRow[];
  targetColors?: Record<string, string>;
  /** Model each target ran on, as recorded on the run. */
  modelByTargetId?: Record<string, string | null>;
  /** Model that judged this comparison, as recorded on the run. */
  judgeModel?: string | null;
};

/** The same props, once the caller has been confirmed to have the data. */
type LoadedProps = ComparisonLeaderboardDrawerProps & {
  column: BatchComparisonColumn;
  rows: BatchResultRow[];
};

type SelectedPair = { winnerId: string; opponentId: string };

/**
 * Everything the three steps are computed from. One hook so the drawer body
 * stays a layout, and so nothing here is recomputed per step.
 */
const useLeaderboardAnalysis = ({
  column,
  rows,
  variantIds,
  variantNames,
  modelByTargetId,
  judgeModel,
}: Pick<LoadedProps, "column" | "rows" | "modelByTargetId" | "judgeModel"> & {
  variantIds: string[];
  variantNames: Record<string, string>;
}) => {
  // Shared across the card and the drawer — see useBTLeaderboard. Both need
  // the same fit for the same column, and it is expensive enough that doing
  // it twice was a visible pause when the drawer opened.
  const leaderboard = useBTLeaderboard({ column, variantIds });
  // Shared across the card and the drawer — see useVariantMetrics. The
  // paired difference intervals made this O(variants squared) bootstraps,
  // so computing it in both places was a second visible pause.
  const variantMetrics = useVariantMetrics({ rows, variantIds });

  const verdict = useMemo(() => computeLeaderboardVerdict(leaderboard), [leaderboard]);
  const cheaperAlternative = useMemo(
    () => findCheaperTiedAlternative({ verdict, variantMetrics }),
    [verdict, variantMetrics],
  );
  const sampleAdequacy = useMemo(() => computeSampleAdequacy(leaderboard), [leaderboard]);
  const verbosity = useMemo(
    () => computeVerbosityProfile({ variantIds, rows, leaderId: verdict.leaderId }),
    [variantIds, rows, verdict.leaderId],
  );
  const judgeIndependence = useMemo(
    () =>
      computeJudgeIndependence({
        judgeModel: judgeModel ?? null,
        modelByVariant: Object.fromEntries(
          variantIds.map((id) => [id, modelByTargetId?.[id] ?? null]),
        ),
      }),
    [judgeModel, modelByTargetId, variantIds],
  );

  // Asked of the checks themselves rather than re-derived from their inputs.
  //
  // The badge on step 2 used to be a parallel boolean listing the conditions
  // it thought were serious, and it had drifted from the panel twice: it
  // never learned about a fit whose graph broke into groups that never met,
  // nor about a bootstrap whose resamples failed to settle. Both render an
  // amber line inside a step whose border and badge stayed neutral, which is
  // the one thing this step must not do — it exists to say "look here".
  // Deriving it means a check added later cannot be forgotten here.
  const trustChecks = useMemo(
    () =>
      buildTrustChecks({
        leaderboard,
        warnThreshold: DEFAULT_WARN_THRESHOLD,
        sampleAdequacy,
        verbosity,
        judgeIndependence,
        variantNames,
        rowsWithoutVerdict: column.rowsWithoutVerdict,
      }),
    [
      leaderboard,
      sampleAdequacy,
      verbosity,
      judgeIndependence,
      variantNames,
      column.rowsWithoutVerdict,
    ],
  );

  return {
    leaderboard,
    variantMetrics,
    verdict,
    cheaperAlternative,
    sampleAdequacy,
    verbosity,
    judgeIndependence,
    trustHasProblem: trustChecks.some((check) => check.tone === "warn"),
  };
};

/** The judge's own words for the one matchup whose cell was clicked. */
function MatchupReasoning({
  pair,
  variantNames,
  verdictsByRow,
}: {
  pair: SelectedPair;
  variantNames: Record<string, string>;
  verdictsByRow: BatchComparisonColumn["verdictsByRow"];
}) {
  // Every row where `winnerId` beat `opponentId` directly.
  const reasons = useMemo(
    () =>
      Object.values(verdictsByRow).filter(
        (v) =>
          v.winnerId === pair.winnerId &&
          (v.candidateIds ?? []).includes(pair.winnerId) &&
          (v.candidateIds ?? []).includes(pair.opponentId) &&
          v.reasoning,
      ),
    [verdictsByRow, pair],
  );

  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={3}>
      <Text fontWeight="semibold" fontSize="sm" marginBottom={2}>
        {variantNames[pair.winnerId] ?? pair.winnerId} vs{" "}
        {variantNames[pair.opponentId] ?? pair.opponentId}
      </Text>
      {reasons.length === 0 ? (
        <Text fontSize="xs" color="fg.muted">
          No reasoning recorded for this matchup.
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          {reasons.map((v, i) => (
            <Box key={v.rowIndex}>
              <Text fontSize="xs" color="fg.muted">
                Row {v.rowIndex + 1}
              </Text>
              <Text fontSize="sm">{v.reasoning}</Text>
              {i < reasons.length - 1 ? <Separator marginTop={2} /> : null}
            </Box>
          ))}
        </VStack>
      )}
    </Box>
  );
}

const SHIP_HELP = (
  <>
    Each verdict the judge gave is read as one matchup per pair of variants in it. Each
    variant gets a score from those, weighted by how strong its opponents were — so
    beating a good variant counts for more than beating a weak one. The score is
    chess-rating style: 0 is average for this group, and it is the GAP that means
    something, not the number. A 400-point gap is roughly 10:1 odds; 0 is a coin flip. The
    shaded band behind each bar is where that score could plausibly sit. Whether two
    variants actually differ is judged on the gap between them rather than on those two
    bands: every resample re-scores the whole field at once, so the scores move together
    and the gap is pinned down better than either score is on its own. Two bands can
    overlap and the run still tell those variants apart.
  </>
);

const TRUST_HELP = (
  <>
    Every check is reported either way, so a silent panel means the check passed rather
    than that it was never run. Ticks are fine, amber is a real problem worth acting on,
    and grey is a measurement for you to judge — like how much longer the leading
    variant&apos;s answers were, which matters because judges tend to favour longer
    answers whether or not they are better.
  </>
);

const TRADEOFF_HELP = (
  <>
    Cost and latency are shown next to quality, never blended into it — a single
    &quot;best overall&quot; number would hide the trade-off you are actually making. All
    three are on one chart: two as position, the third as point size. A variant that is no
    better on any of them is called out above, so you do not have to find it yourself. The
    grid below counts how often each variant beat each other one; click any cell to read
    the judge&apos;s own words for those rows.
  </>
);

/** Step 3: the trade-offs, the head-to-head grid, and the reasoning behind it. */
function TradeoffStep({
  analysis,
  variantNames,
  targetColors,
  verdictsByRow,
}: {
  analysis: ReturnType<typeof useLeaderboardAnalysis>;
  variantNames: Record<string, string>;
  targetColors?: Record<string, string>;
  verdictsByRow: BatchComparisonColumn["verdictsByRow"];
}) {
  const [selectedPair, setSelectedPair] = useState<SelectedPair | null>(null);

  return (
    <LeaderboardStep
      index={3}
      title="What is it costing you, and why did it win?"
      subtitle="Trade-offs, head-to-head detail, and the judge's own reasoning."
      help={TRADEOFF_HELP}
    >
      <VStack align="stretch" gap={4}>
        <TradeoffSummaryLine
          leaderboard={analysis.leaderboard}
          variantMetrics={analysis.variantMetrics}
          variantNames={variantNames}
        />

        <ParetoScatterChart
          leaderboard={analysis.leaderboard}
          variantMetrics={analysis.variantMetrics}
          variantNames={variantNames}
          targetColors={targetColors}
        />

        <Separator />

        <PairwiseLeaderboard
          leaderboard={analysis.leaderboard}
          variantNames={variantNames}
          warnThreshold={DEFAULT_WARN_THRESHOLD}
          showWarnings={false}
          onCellClick={(winnerId, opponentId) =>
            setSelectedPair({ winnerId, opponentId })
          }
        />

        {selectedPair ? (
          <MatchupReasoning
            pair={selectedPair}
            variantNames={variantNames}
            verdictsByRow={verdictsByRow}
          />
        ) : null}
      </VStack>
    </LeaderboardStep>
  );
}

/**
 * Mounted from a URL with no in-memory data behind it.
 *
 * The run's rows are far too large to serialize into a query string, so a
 * reload or a pasted link cannot rebuild them here. Saying so is the point:
 * the alternative was dereferencing `column` anyway, which threw a TypeError
 * into the ErrorBoundary above and silently stripped the drawer from the URL,
 * leaving the reader on the results page with no indication anything had been
 * asked for.
 *
 * Reconstituting properly needs the run identifiers in the URL alongside
 * `evaluatorId` so the drawer can refetch — tracked as a follow-up rather
 * than done here, because it means threading them through two more
 * components.
 */
function LeaderboardNeedsResultsPage({ evaluatorId }: { evaluatorId: string }) {
  const { closeDrawer } = useDrawer();

  return (
    <Drawer.Root open={true} placement="end" size="lg" onOpenChange={closeDrawer}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            Leaderboard
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <Text
            fontSize="sm"
            color="fg.muted"
            data-testid={`leaderboard-needs-results-page-${evaluatorId}`}
          >
            This leaderboard is built from the run&apos;s results, which are not carried
            in the link. Open the run and expand the leaderboard card to see it.
          </Text>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}

export function ComparisonLeaderboardDrawer({
  evaluatorId,
  column,
  rows,
  ...rest
}: ComparisonLeaderboardDrawerProps) {
  // The chart's expand button is the only affordance that opens this, and it
  // is already gone when the flag is off — but a drawer is addressable by URL,
  // so a link shared out of an enabled organization would otherwise render the
  // whole leaderboard for one that has not been given it.
  //
  // Both bails sit ABOVE every deref of `column`. They used to sit seventeen
  // lines below one, so the URL path threw before it could reach this gate and
  // the gate was unreachable on exactly the route it exists to guard.
  const showLeaderboard = useShowComparisonLeaderboard();
  if (!showLeaderboard) return null;
  if (!column || !rows) {
    return <LeaderboardNeedsResultsPage evaluatorId={evaluatorId} />;
  }

  return (
    <LoadedComparisonLeaderboardDrawer
      evaluatorId={evaluatorId}
      column={column}
      rows={rows}
      {...rest}
    />
  );
}

function LoadedComparisonLeaderboardDrawer({
  column,
  rows,
  targetColors,
  modelByTargetId,
  judgeModel,
}: LoadedProps) {
  const { closeDrawer } = useDrawer();

  const variantIds = useMemo(
    () => column.variants.map((v) => v.id).filter((id): id is string => !!id),
    [column.variants],
  );
  const variantNames = useMemo(
    () => Object.fromEntries(column.variants.map((v) => [v.id ?? "", v.name])),
    [column.variants],
  );

  const analysis = useLeaderboardAnalysis({
    column,
    rows,
    variantIds,
    variantNames,
    modelByTargetId,
    judgeModel,
  });

  return (
    <Drawer.Root open={true} placement="end" size="lg" onOpenChange={closeDrawer}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            {column.name} — leaderboard
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <VStack align="stretch" gap={4} paddingBottom={6}>
            <LeaderboardStep
              index={1}
              title="Which one should you ship?"
              subtitle="The ranking, and whether the run actually separates them."
              help={SHIP_HELP}
            >
              <LeaderboardVerdictPanel
                leaderboard={analysis.leaderboard}
                verdict={analysis.verdict}
                cheaperAlternative={analysis.cheaperAlternative}
                variantNames={variantNames}
                targetColors={targetColors}
              />
            </LeaderboardStep>

            <LeaderboardStep
              index={2}
              title="Can you trust that?"
              subtitle="What this run does and does not support."
              help={TRUST_HELP}
              hasProblem={analysis.trustHasProblem}
            >
              <LeaderboardTrustPanel
                leaderboard={analysis.leaderboard}
                rowsWithoutVerdict={column.rowsWithoutVerdict}
                warnThreshold={DEFAULT_WARN_THRESHOLD}
                sampleAdequacy={analysis.sampleAdequacy}
                verbosity={analysis.verbosity}
                judgeIndependence={analysis.judgeIndependence}
                variantNames={variantNames}
              />
            </LeaderboardStep>

            <TradeoffStep
              analysis={analysis}
              variantNames={variantNames}
              targetColors={targetColors}
              verdictsByRow={column.verdictsByRow}
            />
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
