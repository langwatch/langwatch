import {
  Alert,
  Heading,
  HStack,
  SimpleGrid,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import type {
  GovernanceCostDayDto,
  GovernanceCostStaleSourcesDto,
  GovernanceCostSummaryDto,
  GovernanceCostUnpricedWindowDto,
} from "@ee/governance/services/governanceCost.service";
import numeral from "numeral";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  CostLanePanel,
  SeatLanePanel,
} from "~/components/governance/CostLanePanel";
import {
  CHART_SEAT_CONTRACT_FILL,
  CHART_SEAT_FILL,
} from "~/components/governance/chartTheme";
import { azureBillingNoteSentence } from "~/components/governance/costLaneFormat";
import {
  CostDonut,
  CostForecastArea,
  CostLine,
  CostRankList,
  CostStackedBars,
  fmtWhole,
} from "~/components/governance/costs/CostCharts";
import { CostFilterBar } from "~/components/governance/costs/CostFilterBar";
import { CostPanel } from "~/components/governance/costs/CostPanel";
import {
  CostPanelEmpty,
  costPanelEmpty,
} from "~/components/governance/costs/CostPanelEmpty";
import {
  CostSpenderError,
  CostSpenderList,
  type SpenderRow,
} from "~/components/governance/costs/CostSpenderPanel";
import {
  declinedAsEmpty,
  isRefusedRead,
  refusedAsEmpty,
  summaryAsRead,
} from "~/components/governance/costs/costSampleMode";
import {
  ALL_DEPARTMENTS,
  aggregateBuckets,
  aggregateLaneTrend,
  aggregateLine,
  aggregateSeatCounts,
  bucketStartOf,
  frameExceedsReadCeiling,
  windowDaysForFrame,
} from "~/components/governance/costs/costsWindow";
import {
  sampleCostSummary,
  sampleSpenderRows,
} from "~/components/governance/costs/sampleLanes";
import { SampleSaidOnce } from "~/components/governance/costs/sampleMark";
import {
  type DailyBucket,
  type RankRow,
  recentMonths,
  SAMPLE_AGENTS,
  SAMPLE_DEPARTMENTS,
  sampleAdoption,
  sampleDaily,
  sampleForecast,
  sampleLine,
  sampleRanked,
  sampleSeats,
} from "~/components/governance/costs/sampleSeries";
import {
  coerceInterval,
  DEFAULT_TIME_FRAME,
  DEFAULT_TIME_INTERVAL,
  frameSpanDays,
  type TimeFrame,
  type TimeInterval,
} from "~/components/governance/filters";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  SampleDataBanner,
  SampleDataToggle,
  useSampleMode as useGovernanceSampleMode,
  useSettledRealDataState,
} from "~/components/governance/sample";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useActivePlan } from "~/hooks/useActivePlan";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * The cost screen: three lanes, side by side, each labeled for what it is,
 * and the breakdowns underneath them.
 *
 * The lanes are never added together. What a provider invoices and what the
 * gateway metered are two different measurements of overlapping traffic, and
 * the gap between them is the thing worth looking at — a combined figure would
 * hide exactly what the screen exists to show. That is why nothing on this page
 * shows a single "total AI cost".
 *
 * Nothing here ever renders a zero it did not measure. A failed read, a
 * deployment without a cost store, and a lane with no figure all render as
 * such; `$0.00` is reserved for a lane that really did report no spend.
 *
 * ONE TIME AXIS. Two chips set the window: Time Frame (how far back) and Time
 * Interval (how wide each bucket is), the section-wide pair from
 * `~/components/governance/filters`, opening on Quarter over the last twelve
 * months. Every chart on the page is bucketed and ticked by that interval,
 * because a screen set to Quarter that still draws one chart by day puts two
 * axes side by side that look alike and are not the same span — the one chart
 * mistake a reader has no way to catch. The reads answer in days and take no
 * bucket parameter, so the fold happens on the client; `costsWindow.ts` says
 * why, and why the frame is clamped to the reads' 365-day ceiling.
 *
 * SAMPLE MODE SUPPRESSES FAILURE. With sample data on, no error alert renders
 * and no panel says "not available": the lanes, the breakdowns and the spender
 * list all draw invented figures under the sample badge instead. The screen's
 * job in that mode is to show what a filled-in Costs page looks like, and a
 * red alert across the top of it does not. Everything real comes straight back
 * the moment the reader turns sample data off — that toggle is the exit, and
 * it is always on screen.
 *
 * The invented panels do not render unconditionally. They fill a screen with
 * nothing measured on it, step aside once real figures arrive, and the reader
 * can overrule either default from the toggle in the header — the same
 * arrangement the trace explorer uses for its sample traces. See
 * `~/components/governance/sample` for why an unanswered read is not
 * treated as an empty one.
 *
 * Spec: specs/governance/governance-cost-screen.feature (ADR-128)
 */

interface CostFilters {
  department: string;
  /**
   * Carried alongside the id rather than looked up from the response. The
   * options come from the window being viewed, so a lookup has nothing to find
   * the moment the window changes, and the chip would name a department the
   * screen is no longer filtering by — or worse, name all of them.
   */
  departmentName: string | null;
  frame: TimeFrame;
  interval: TimeInterval;
}

/**
 * Drops a department selection the current window no longer contains.
 *
 * A window can answer without the department the reader is standing on: it
 * spent nothing over the shorter span, so it has no row and no option in the
 * picker. The selection would stay behind and filter every remaining row away,
 * leaving an empty panel under a chip that no longer had a name to show.
 * Clearing it is the only outcome where the label and the rows agree.
 *
 * Only an answered read counts. A read still in flight is not evidence that the
 * department is gone, and resetting on one would throw the reader's choice away
 * on every refetch.
 *
 * Sample mode is exempt: the sample departments are a fixed list that never
 * drops a name, and running the reset against the real reads while the reader
 * is looking at invented departments would clear a selection that is still on
 * screen.
 */
function useDepartmentSelectionReset({
  filters,
  breakdowns,
  setFilters,
  showSample,
}: {
  filters: CostFilters;
  breakdowns: Breakdowns;
  setFilters: Dispatch<SetStateAction<CostFilters>>;
  showSample: boolean;
}) {
  const { departmentRows, departments } = breakdowns;
  const selected = filters.department;
  useEffect(() => {
    if (showSample) return;
    if (selected === ALL_DEPARTMENTS) return;
    if (departmentRows === null) return;
    if (departments.some((d) => d.id === selected)) return;
    setFilters((current) => ({
      ...current,
      department: ALL_DEPARTMENTS,
      departmentName: null,
    }));
  }, [selected, departmentRows, departments, setFilters, showSample]);
}

/**
 * The pulled lane's spender breakdown. Split-grant rule as the breakdowns
 * above: the spender labels are the People screen's data, so the read is
 * gated on that screen's permission — the server refuses it anyway, this
 * just spares the failed query.
 */
function useSpenderRows({
  organizationId,
  windowDays,
  enabled,
}: {
  organizationId: string;
  windowDays: number;
  enabled: boolean;
}) {
  const spenders = api.governanceCost.spenders.useQuery(
    { organizationId, windowDays },
    { enabled, refetchOnWindowFocus: false },
  );
  return {
    rows: spenders.data?.rows ?? null,
    // Carried out separately instead of collapsed into null: null is this
    // screen's word for "unanswered or absent", and a failed read is neither
    // — hiding the panel on an outage would claim nobody spent anything.
    isError: spenders.isError,
    // A decline is not an outage. Carried apart from `isError` so the panel can
    // show what it holds instead of accusing the read of breaking.
    refused: isRefusedRead(spenders.error),
    retry: () => void spenders.refetch(),
  };
}

/**
 * Whether the invented sample panels are on. `optIn` stays `null` until the
 * reader picks a side, which is what lets the default follow the data.
 * Deliberately not persisted: the same rule the trace explorer applies to its
 * sample traces — opting in is a decision about this sitting, not a
 * preference that follows you back tomorrow.
 *
 * Adoption counts as real data even with no spend behind it yet: showing a
 * measured headcount beside invented money is the confusion this toggle
 * exists to prevent. So does the headline summary: a pulled bill with no
 * activity behind it is still real money, and must keep the invented panels
 * off the screen it heads.
 */
function useSampleMode(
  breakdowns: ReturnType<typeof useBreakdownQueries>,
  // The read itself, not its data: whether it was DECLINED is half the answer
  // here, and that only lives on the error.
  summary: {
    data: GovernanceCostSummaryDto | undefined;
    error: { data?: { code?: string | null } | null } | null;
  },
) {
  const summaryData = summary.data;
  const summaryError = summary.error;
  // The choice itself is the section's, not this page's: whichever governance
  // screen the reader last pressed the toggle on is the answer here too. Only
  // the reads below are the page's own.
  const { active, toggle } = useGovernanceSampleMode({
    realData: useSettledRealDataState([
      // A refused read has answered — with nothing. Left as `null` it read as
      // "still unknown", which held the sample panels off the one screen they
      // are for: an organization whose plan or grants do not open this page at
      // all, which is every organization on its first visit. See
      // `isRefusedRead`.
      refusedAsEmpty(summaryAsRead(summaryData), summaryError),
      // The same treatment for the activity reads, which are refused by the
      // same gate. A first visit has every one of these declined at once, and
      // it was that whole-screen silence that kept the invented panels off.
      declinedAsEmpty(breakdowns.departmentRows, breakdowns.refused),
      declinedAsEmpty(breakdowns.userRows, breakdowns.refused),
      declinedAsEmpty(breakdowns.overTime, breakdowns.refused),
      declinedAsEmpty(breakdowns.modelOverTime, breakdowns.refused),
      declinedAsEmpty(
        breakdowns.activeUsers === null
          ? null
          : { length: breakdowns.activeUsers },
        breakdowns.refused,
      ),
    ]),
  });
  return { showSample: active, toggleSample: toggle };
}

function CostsPage() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const organizationId = organization?.id ?? "";
  const [filters, setFilters] = useState<CostFilters>({
    department: ALL_DEPARTMENTS,
    departmentName: null,
    frame: DEFAULT_TIME_FRAME,
    interval: DEFAULT_TIME_INTERVAL,
  });
  const patch = (next: Partial<CostFilters>) =>
    setFilters((current) => ({ ...current, ...next }));

  /**
   * Narrowing the frame can leave the reader on an interval the new frame
   * cannot draw — a quarter over three months is one bar wearing a chart's
   * clothes. The section-wide rule steps down to the widest that still fits,
   * in one place so every governance page answers alike.
   */
  const chooseFrame = (frame: TimeFrame) =>
    patch({
      frame,
      interval: coerceInterval({ interval: filters.interval, frame }),
    });

  const windowDays = windowDaysForFrame({ frame: filters.frame });

  const summary = api.governanceCost.summary.useQuery(
    { organizationId, windowDays },
    { enabled: !!organizationId },
  );
  const breakdowns = useBreakdownQueries({
    organizationId,
    windowDays,
    // The page opens on `governanceCost:view`, but the breakdowns read the
    // activity monitor, which is its own grant. A viewer holding one and not
    // the other gets the lanes and no failed queries underneath them.
    enabled: !!organizationId && hasAnyPermission("activityMonitor:view"),
  });
  const spenders = useSpenderRows({
    organizationId,
    windowDays,
    enabled: !!organizationId && hasAnyPermission("governance:view"),
  });

  const { showSample, toggleSample } = useSampleMode(breakdowns, summary);
  const samplePeriods = useSamplePeriods(filters.frame);

  useDepartmentSelectionReset({ filters, breakdowns, setFilters, showSample });

  const departmentOptions = showSample
    ? SAMPLE_DEPARTMENTS.map((name) => ({ id: name, name }))
    : breakdowns.departments;
  const holdsFigures = summaryHoldsFigures(summary.data, summary.isError);

  return (
    <GovernanceLayout pageTitle="Costs · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full">
        <HStack justify="space-between" align="center">
          <Heading size="md">Costs</Heading>
          <SampleDataToggle active={showSample} onToggle={toggleSample} />
        </HStack>
        {showSample && <SampleDataBanner />}
        {/* Everything under the banner inherits what the banner said. While it
            is up, the per-panel marks stand down rather than restating it
            sixteen times; the moment it comes down they are the only thing
            telling an invented panel from a measured one, and they return.
            `sampleMark.tsx` carries the reasoning. */}
        <SampleSaidOnce said={showSample}>
          <CostFilterBar
            departmentName={filters.departmentName}
            departments={departmentOptions}
            onDepartmentChange={(department, departmentName) =>
              patch({ department, departmentName })
            }
            frame={filters.frame}
            onFrameChange={chooseFrame}
            interval={filters.interval}
            onIntervalChange={(interval) => patch({ interval })}
          />
          <ReadCeilingNotice frame={filters.frame} showSample={showSample} />

          <CostsBody
            isLoading={summary.isLoading && !!organizationId}
            isError={summary.isError}
            refused={isRefusedRead(summary.error)}
            data={summary.data}
            interval={filters.interval}
            showSample={showSample}
            samplePeriods={samplePeriods}
          />

          <CostBreakdowns
            filters={filters}
            breakdowns={breakdowns}
            periods={samplePeriods}
            showSample={showSample}
            spenders={spenders}
            sourcesConnected={holdsFigures}
          />
        </SampleSaidOnce>
      </VStack>
    </GovernanceLayout>
  );
}

/**
 * Said out loud when the frame asks for more history than the reads answer.
 *
 * The Time Frame chip offers Last 2 years because every governance page offers
 * the same four spans, and the cost reads cap their window at a year. Silently
 * serving twelve months under a two-year label is the shape of mistake this
 * whole screen is built to avoid, so the shortfall is stated where the figures
 * are read. Nothing is stated in sample mode: the invented series are not a
 * read and are not clamped.
 */
function ReadCeilingNotice({
  frame,
  showSample,
}: {
  frame: TimeFrame;
  showSample: boolean;
}) {
  if (showSample || !frameExceedsReadCeiling({ frame })) return null;
  return (
    <Text fontSize="xs" color="fg.muted" data-testid="cost-read-ceiling-note">
      Figures cover the last 12 months. Cost history does not go back further
      than that yet.
    </Text>
  );
}

/**
 * What a reader sees when the server declined the read.
 *
 * Two causes reach the client as the same tRPC FORBIDDEN, and prose is not
 * evidence — the message is copy and will be rewritten. The plan is, so the
 * live plan tells the two apart: an organization off the Enterprise tier was
 * refused by the gate, and one on it was refused by its own grants. Naming the
 * wrong one sends a customer to the wrong place, so neither sentence guesses.
 *
 * Status `info`, never `error`. Nothing failed, nothing needs retrying, and
 * this is not a state support can fix.
 */
function CostsRefused() {
  const { isEnterprise } = useActivePlan();
  return (
    <Alert.Root status="info" data-testid="cost-lanes-refused">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>
          {isEnterprise
            ? "You do not have access to cost data"
            : "Cost data comes with the Enterprise plan"}
        </Alert.Title>
        <Alert.Description>
          {isEnterprise
            ? "Your role does not open the cost views for this organization. An organization admin can grant it."
            : "This organization's plan does not include the cost views, so no figures were read. Nothing is wrong with your setup."}{" "}
          {/* Phrased as an invitation, not a statement of fact: this notice is
              only ever on screen with the samples turned OFF, so telling the
              reader they are on would be wrong at the exact moment it is read. */}
          Sample data shows what this screen holds once it opens.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/**
 * The body's states, kept in one place so no branch can quietly acquire a zero:
 * sample, loading, refused read, failed read, unavailable, and figures.
 *
 * Sample comes first on purpose. It is the reader's explicit "show me what
 * this looks like", and the three states below it are all ways of saying we
 * have nothing to show — exactly what sample mode is there to answer.
 */
function CostsBody({
  isLoading,
  isError,
  refused,
  data,
  interval,
  showSample,
  samplePeriods,
}: {
  isLoading: boolean;
  isError: boolean;
  /** The read was declined, not broken. See `isRefusedRead`. */
  refused: boolean;
  data: GovernanceCostSummaryDto | undefined;
  interval: TimeInterval;
  showSample: boolean;
  samplePeriods: string[];
}) {
  // Sample mode exists to fill a blank screen — the same test the panels below
  // apply to themselves, asked once for all three lanes. See
  // `summaryHoldsFigures` for why the adoption card asks it too.
  const holdsFigures = summaryHoldsFigures(data, isError);
  if (showSample && !holdsFigures) {
    return (
      <CostLanes
        data={sampleCostSummary(samplePeriods)}
        interval={interval}
        sample
      />
    );
  }

  if (holdsFigures) {
    return <CostLanes data={data} interval={interval} sample={false} />;
  }

  return (
    <CostsWithoutFigures
      isLoading={isLoading}
      isError={isError}
      refused={refused}
      data={data}
    />
  );
}

/**
 * Every state that is not a chart, in the order they answer: still reading,
 * declined, broken, and an account with nothing recorded against it.
 *
 * Split out so the one branch that draws money is a single line, and so the
 * four ways of having nothing to show sit together where the difference
 * between them is easy to read. That difference is the whole point — each says
 * something different about whose problem it is, and the page used to answer
 * three of them with the same red alert.
 */
function CostsWithoutFigures({
  isLoading,
  isError,
  refused,
  data,
}: {
  isLoading: boolean;
  isError: boolean;
  refused: boolean;
  data: GovernanceCostSummaryDto | undefined;
}) {
  if (isLoading) {
    return (
      <VStack align="stretch" gap={4} data-testid="cost-lanes-loading">
        <Skeleton height="120px" />
        <Skeleton height="260px" />
      </VStack>
    );
  }

  // A declined read is not a broken one. The plan gate and the permission
  // check both answer before any cost is read, so nothing was attempted and
  // nothing failed — telling the reader something went wrong would send them
  // to support over an account setting. Named ahead of the outage branch
  // because "we refused" is the more specific answer wherever both are true.
  if (refused) {
    return <CostsRefused />;
  }

  // A failed read is an outage, not an empty account. Rendering the lanes with
  // zeros here would state that nothing was spent, which we do not know.
  if (isError || !data) {
    return (
      <Alert.Root status="error" data-testid="cost-lanes-error">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Cost data could not be loaded</Alert.Title>
          <Alert.Description>
            Something went wrong reading your cost figures. Try again in a
            moment. Nothing is shown rather than a total we cannot stand behind.
          </Alert.Description>
        </Alert.Content>
      </Alert.Root>
    );
  }

  return (
    <Alert.Root status="info" data-testid="cost-lanes-unavailable">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Cost data is unavailable</Alert.Title>
        <Alert.Description>
          {data.unavailableReason === "no_cost_store"
            ? "This deployment does not have cost storage configured, so no cost has been recorded."
            : "No cost has been recorded for this organization yet."}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/**
 * The three lanes, in the same panel shell as everything below them.
 *
 * One height for all three, which is a row of cards and not three cards that
 * happen to be adjacent. The seats lane lists a line per licence pool and the
 * money lanes hold one figure each, so the heights differ by a lot and the
 * ragged bottom edge was the first thing the eye landed on.
 *
 * Letting each card end at its own content was the earlier answer here, and it
 * traded one problem for another: the ragged edge went away and the two money
 * cards became visibly stubby beside the seats card. The height was never the
 * real complaint. Empty box below a figure was, and a shorter card has exactly
 * as much of it — the emptiness just moves outside the border where it reads as
 * a layout that gave up rather than a card with room.
 *
 * So: stretch, and the cards earn the height. Each lane pins its explanation to
 * its own bottom edge (`marginTop="auto"` in CostLanePanel), which puts the
 * slack between the figure and its footing and closes all three lanes on one
 * line. Two aligned edges, top and bottom, and the difference in content sits
 * where a reader reads it as spacing.
 */
function CostLanes({
  data,
  interval,
  sample,
}: {
  data: GovernanceCostSummaryDto;
  /** The bucket width in view, which the lane sparklines are folded to. */
  interval: TimeInterval;
  sample: boolean;
}) {
  // Both lanes' shapes come off the one series the totals above them were
  // summed from, so a card's sparkline and its figure cannot describe
  // different money.
  const trendOf = (pick: (day: GovernanceCostDayDto) => number | null) =>
    aggregateLaneTrend(
      data.series.map((day) => ({ day: day.day, value: pick(day) })),
      interval,
    );
  return (
    <VStack align="stretch" gap={6}>
      <StaleSourcesNotice staleSources={data.staleSources} />
      <UnpricedWindowNotice unpricedWindow={data.unpricedWindow} />
      <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
        <CostLanePanel
          testId="cost-lane-billed"
          label="Billed by provider"
          description="What your providers report they will invoice."
          amountUsd={data.billed.amountUsd}
          cellsWithoutAmount={data.billed.cellsWithoutAmount}
          currenciesWithoutUsdAmount={data.billed.currenciesWithoutUsdAmount}
          laneNote={
            data.azureBilling
              ? azureBillingNoteSentence(data.azureBilling)
              : null
          }
          trend={trendOf((day) => day.billedUsd)}
          interval={interval}
          sample={sample}
        />
        <CostLanePanel
          testId="cost-lane-gateway"
          label="Metered by gateway"
          description="What the gateway measured as it served your traffic."
          amountUsd={data.gateway.amountUsd}
          cellsWithoutAmount={data.gateway.cellsWithoutAmount}
          currenciesWithoutUsdAmount={data.gateway.currenciesWithoutUsdAmount}
          trend={trendOf((day) => day.gatewayUsd)}
          interval={interval}
          sample={sample}
        />
        <SeatLanePanel
          testId="cost-lane-seats"
          seats={data.seats}
          sample={sample}
        />
      </SimpleGrid>
    </VStack>
  );
}

/**
 * Where the numbers below stop being complete (ADR-128 §4a).
 *
 * A source that is failing to pull still has a lane on this screen; it just
 * contributes nothing to it, so the totals fall and nothing says why. Without
 * this line a broken credential reads as a cheap month, which is the one
 * reading of a cost screen that is worse than no cost screen.
 *
 * The wording says "failing to pull" rather than "stopped pulling" because
 * that is the whole of what the check behind it detects: a run of consecutive
 * pull failures. A source whose worker is never scheduled keeps a zero failure
 * count and is never named here, though its figures are just as incomplete —
 * see the known gap recorded on the Rule in
 * `specs/governance/governance-cost-screen.feature`. Claiming "stopped" would
 * promise a guarantee this line cannot keep.
 *
 * The sources are named because "something is failing" is not actionable and
 * "Azure Billing is failing" is.
 */
function StaleSourcesNotice({
  staleSources,
}: {
  staleSources: GovernanceCostStaleSourcesDto | null;
}) {
  if (!staleSources) return null;

  const since = new Date(staleSources.oldestLastSuccessIso).toLocaleDateString(
    undefined,
    { year: "numeric", month: "short", day: "numeric" },
  );

  return (
    <Alert.Root status="warning" data-testid="cost-stale-sources">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>No data since {since}</Alert.Title>
        <Alert.Description>
          {staleSources.sourceNames.join(", ")}{" "}
          {staleSources.sourceNames.length === 1 ? "is" : "are"} failing to
          pull, so spend after that point is unknown rather than zero.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/**
 * Days that were read but never priced, because pulled cost recording was off.
 *
 * The sibling of the notice above, for a gap nothing broke to cause. Those days
 * have their audit rows; only the money was dropped, and a dropped figure draws
 * as zero. Turning the setting on stops the loss from growing but does not undo
 * it — the pull cursor moved past those days and will not revisit them on its
 * own — so the line has to say both, or a reader fixes the setting and believes
 * the history is now correct.
 *
 * Dates rather than "since": this gap is bounded at both ends, and a gap that
 * closed last month should not read as an open wound.
 */
function UnpricedWindowNotice({
  unpricedWindow,
}: {
  unpricedWindow: GovernanceCostUnpricedWindowDto | null;
}) {
  if (!unpricedWindow) return null;

  const asDay = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const since = asDay(unpricedWindow.sinceIso);
  const through = asDay(unpricedWindow.throughIso);
  const span = since === through ? since : `${since} to ${through}`;

  return (
    <Alert.Root status="warning" data-testid="cost-unpriced-window">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>Spend not recorded for {span}</Alert.Title>
        <Alert.Description>
          {unpricedWindow.sourceNames.join(", ")} read those days while this
          organization was not recording pulled cost, so their spend is unknown
          rather than zero. Switching recording on stops the loss but leaves
          these days empty — move a source&apos;s start date back across them to
          read them again.
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

/**
 * What the activity reads have answered so far.
 *
 * Every field is nullable and `null` means the read has not answered — still in
 * flight, or never allowed to run because the viewer lacks the grant. It is
 * deliberately NOT collapsed to `0`/`[]`: this screen does not show a figure it
 * did not measure, and a zero is a measurement.
 */
interface Breakdowns {
  departments: Array<{ id: string; name: string }>;
  departmentRows: Array<{
    departmentId: string | null;
    departmentName: string;
    spendUsd: string;
  }> | null;
  userRows: Array<{
    actor: string;
    spendUsd: string;
    requests: number;
  }> | null;
  activeUsers: number | null;
  overTime: DailyBucket[] | null;
  modelOverTime: DailyBucket[] | null;
  /**
   * The activity reads were declined rather than broken — the plan gate or a
   * missing `activityMonitor:view`. Distinct from the rows being null, which
   * on its own cannot tell a refusal from a read still in flight.
   */
  refused: boolean;
}

/** Wire buckets carry money as strings; the charts want numbers. */
function toDailyBuckets(
  buckets:
    | Array<{
        bucketIso: string;
        points: Array<{ key: string; label: string; spendUsd: string }>;
      }>
    | undefined,
): DailyBucket[] {
  if (!buckets) return [];
  return buckets.map((bucket) => ({
    day: bucket.bucketIso,
    points: bucket.points.map((point) => ({
      key: point.key,
      label: point.label,
      value: Number(point.spendUsd),
    })),
  }));
}

/**
 * The reads under the breakdown panels.
 *
 * The over-time read is grouped by team and nothing chooses otherwise any
 * more. Group By was a chip that renamed one chart's series while every panel
 * around it ignored it; the chart says "by team" in its own title instead,
 * where the reader looking at it will see it.
 */
function useBreakdownQueries({
  organizationId,
  windowDays,
  enabled,
}: {
  organizationId: string;
  windowDays: number;
  enabled: boolean;
}): Breakdowns {
  const args = { organizationId, windowDays };
  const options = { enabled, refetchOnWindowFocus: false };

  const summary = api.activityMonitor.summary.useQuery(args, options);
  const byDepartment = api.activityMonitor.spendByDepartment.useQuery(
    args,
    options,
  );
  const byUser = api.activityMonitor.spendByUser.useQuery(
    { ...args, limit: 8 },
    options,
  );
  const overTime = api.activityMonitor.spendOverTime.useQuery(
    { ...args, groupBy: "team" as const },
    options,
  );
  const byModel = api.activityMonitor.spendOverTime.useQuery(
    { ...args, groupBy: "model" as const },
    options,
  );

  const departmentRows = byDepartment.data ?? null;
  // The picker is the one place an unanswered read may fall back to empty: it
  // offers choices, it does not report a measurement. Memoised because the
  // selection reset watches this list, and a fresh array every render would
  // wake that effect on every render.
  const departments = useMemo(
    () =>
      (departmentRows ?? []).map((row) => ({
        id: row.departmentId ?? "unassigned",
        name: row.departmentName,
      })),
    [departmentRows],
  );
  return {
    departmentRows,
    departments,
    userRows: byUser.data ?? null,
    activeUsers: summary.data?.activeUsersThisWindow ?? null,
    // One flag for the group: the activity monitor sits behind a single plan
    // gate and a single grant, so these five reads are refused together or not
    // at all. The sample decision needs it because a declined read is an
    // answer of nothing, and left as `null` it read as "still waiting".
    refused:
      isRefusedRead(summary.error) ||
      isRefusedRead(byDepartment.error) ||
      isRefusedRead(byUser.error) ||
      isRefusedRead(overTime.error) ||
      isRefusedRead(byModel.error),
    // `.buckets`, not the result object: the read answers a wrapper, and
    // handing the wrapper to a function that maps over an array throws the
    // moment a real answer arrives.
    overTime: overTime.data ? toDailyBuckets(overTime.data.buckets) : null,
    modelOverTime: byModel.data ? toDailyBuckets(byModel.data.buckets) : null,
  };
}

/** Total each series across the window, for the ranked and donut panels. */
function totalPerSeries(buckets: DailyBucket[]): RankRow[] {
  const totals = new Map<string, RankRow>();
  for (const bucket of buckets) {
    for (const point of bucket.points) {
      const existing = totals.get(point.key);
      if (existing) {
        existing.value += point.value;
      } else {
        totals.set(point.key, { ...point });
      }
    }
  }
  return [...totals.values()];
}

/**
 * What the invented money adds up to, and why these three numbers.
 *
 * Every sample figure on the screen is scaled from `SAMPLE_MONTHLY_TOP`, so
 * the lanes, the time charts and the ranked panels all describe one imaginary
 * organization rather than five. They were generated independently before,
 * which is how the department panel came to read $10.2k under a chart of the
 * same money drawing $280k a quarter — a screen that does not add up teaches a
 * reader to distrust the real one.
 *
 * `sampleDaily` decays each series by half, so five of them sum to about 1.94
 * times the leader; that is where the window total comes from.
 */
const SAMPLE_MONTHLY_TOP = 7_400;
const SAMPLE_SERIES_DECAY_SUM = 1.94;
/** Roughly what a twelve-month window holds, for the panels with no series. */
const SAMPLE_WINDOW_TOTAL = SAMPLE_MONTHLY_TOP * SAMPLE_SERIES_DECAY_SUM * 12;

/**
 * How busy the invented organization's agents are, in conversations.
 *
 * DERIVED, NOT PICKED. The conversation count used to be a round number chosen
 * on its own, which left it saying nothing about the same organization the
 * adoption panel describes two rows above. It is now that panel's own
 * headcount times a rate — a person who uses AI tools at work has about one
 * conversation a week — so the two panels answer to each other and a reader
 * who divides one by the other gets a number that means something.
 *
 * Six series decaying by half sum to about 1.97 times their leader, which is
 * where the divisor comes from.
 */
const SAMPLE_CONVERSATIONS_PER_PERSON_MONTH = 4.5;
const SAMPLE_SIX_SERIES_DECAY_SUM = 1.97;
const SAMPLE_CONVERSATIONS_TOP = Math.round(
  (sampleAdoption().peopleUsingAiTools *
    SAMPLE_CONVERSATIONS_PER_PERSON_MONTH) /
    SAMPLE_SIX_SERIES_DECAY_SUM,
);

/** The models and people the ranked sample panels name. */
const SAMPLE_MODELS = [
  "gpt-5-mini",
  "gpt-5",
  "claude-sonnet-5",
  "claude-haiku-4-5",
];
const SAMPLE_PEOPLE = [
  "ada@acme.test",
  "grace@acme.test",
  "alan@acme.test",
  "edsger@acme.test",
  "barbara@acme.test",
];

/** Every invented series the breakdowns draw from, already folded. */
type SampleSeries = ReturnType<typeof useSampleSeries>;

/**
 * The pulled lane's spender read. `rows` is null while unanswered — the read
 * is refused without the People screen's permission — and a failure is carried
 * separately, because hiding the panel on an outage would claim nobody spent
 * anything.
 */
interface SpenderReadState {
  rows: SpenderRow[] | null;
  isError: boolean;
  /** Declined by the plan gate or a missing grant, rather than broken. */
  refused: boolean;
  retry: () => void;
}

/**
 * The seat chart's two series, coloured apart.
 *
 * Both hues come from the shared chart theme rather than being picked here, so
 * that these bars and the per-pool meter in the lane card cannot drift into two
 * different colours for one subject — which is exactly what they had done, in
 * two blues a reader could not tell apart. The reasoning is on the constants.
 */
const SEAT_SERIES_COLORS: Record<string, string> = {
  bought: CHART_SEAT_CONTRACT_FILL,
  assigned: CHART_SEAT_FILL,
};

/** Where a reader goes to make an empty panel stop being empty. */
const ADD_A_SOURCE = {
  label: "Add a source",
  to: "/governance/inventory?tab=sources",
} as const;
const MANAGE_DEPARTMENTS = {
  label: "Manage departments",
  to: "/governance/people?tab=departments",
} as const;

/**
 * The billed-spend-by-key panel's slot in the grid.
 *
 * BY KEY, NOT BY PERSON. A provider's invoice attributes spend to the
 * credential that was presented, and nothing else — it has no idea who was
 * holding it. Titling this by person promised an attribution the billing
 * pipeline cannot make and quietly turned a key four engineers share into one
 * person's spend. The read is unchanged; what changed is that the screen now
 * claims exactly as much as the bill does.
 *
 * Different money from "Metered spend by person" on purpose: that panel is the
 * cost recorded on traces as they were served, this one is what the provider's
 * BILL charged. They disagree legitimately and are never reconciled — each is
 * labeled for its lane.
 *
 * ONE PANEL, FOUR CONTENTS. This used to return a different `CostPanel` per
 * state, sample included, which made the invented case a separate panel that
 * happened to look like the real one. A panel is a real component whose data
 * source is invented in sample mode, never a sample panel of its own: the
 * shell, the title and the badge are decided once here, and only the rows
 * below them differ.
 */
const BILLED_BY_KEY = "Billed spend by API key";

function SpenderPanelSlot({
  spenders,
  showSample,
}: {
  spenders: SpenderReadState;
  showSample: boolean;
}) {
  const measured =
    spenders.rows !== null && spenders.rows.length > 0 ? spenders.rows : null;
  // Sample fills a panel holding nothing and never displaces measured rows —
  // the same rule the breakdown grid applies to every panel in it.
  const invented = measured === null && showSample;
  const rows = measured ?? (invented ? sampleSpenderRows() : null);

  return (
    <CostPanel title={BILLED_BY_KEY} sample={invented}>
      <SpenderPanelBody rows={rows} spenders={spenders} />
    </CostPanel>
  );
}

function SpenderPanelBody({
  rows,
  spenders,
}: {
  rows: SpenderRow[] | null;
  spenders: SpenderReadState;
}) {
  if (rows) return <CostSpenderList rows={rows} />;
  // Only a real failure gets the failure state. A refusal falls through to the
  // empty state below, which says what the panel holds and what would fill it —
  // true of a declined read, where "try again" is advice that cannot work.
  if (spenders.isError && !spenders.refused)
    return <CostSpenderError onRetry={spenders.retry} />;
  return (
    <CostPanelEmpty
      unanswered={spenders.rows === null}
      what="What the provider's own bill charged against each API key."
      source="Fills once a billing source is pulling and its rows name a key."
      action={ADD_A_SOURCE}
    />
  );
}

/**
 * The two wide panels that only exist in sample mode.
 *
 * Both illustrate a measurement the platform does not take yet, so neither has
 * a real counterpart to stand aside for — they are simply absent when sample
 * mode is off, rather than rendering empty.
 */
function SampleHeadlinePanels({
  sample,
  interval,
}: {
  sample: SampleSeries;
  interval: TimeInterval;
}) {
  return (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
      {/*
        "Metered spend", not "consumption": the gateway lane above is labelled
        "Metered by gateway" and ADR-128 §2 calls this money gateway metering
        throughout. A screen that names the same money two ways teaches the
        reader they are two things.
      */}
      <CostPanel title="Metered spend forecast · by agent" sample>
        <CostForecastArea
          buckets={sample.forecast.buckets}
          projectedFromDay={sample.forecast.projectedFromDay}
          interval={interval}
        />
      </CostPanel>
      {/*
        Seats are COUNTS (ADR-128 §6, and §16's wave-1 aggregate: "you pay for
        N seats, M are assigned"). This panel used to draw them as daily
        dollars, which is wrong twice over — nobody is charged for a
        subscription daily, and §6's reversal note says seat money is not
        something this product holds at all. Bought and assigned are drawn side
        by side rather than stacked; the gap between them is the idle seats the
        panel exists to show.

        Per licence pool rather than per department: the wave-1 seat read is
        the provider's own SKU/roster count, and per-person assignment facts —
        the only thing that could attribute a seat to a department — are named
        in §16 as wave 2.
      */}
      <CostPanel title="Seats · bought against assigned" sample>
        {/* Whole numbers, like the conversations panel: a seat is a thing
            somebody was given, and "1.2k seats" is not how a licence count is
            ever discussed.

            Explicit colours because the two series are the panel: bought and
            assigned hashed to two blues that had to be told apart by reading
            the legend, on the one chart whose whole content is the gap between
            them. Bought is the outline of what is paid for and assigned is
            what is used, so the used half carries the stronger colour. */}
        <CostStackedBars
          buckets={sample.seats}
          format={fmtWhole}
          interval={interval}
          colorFor={(key) => SEAT_SERIES_COLORS[key]}
          grouped
        />
      </CostPanel>
    </SimpleGrid>
  );
}

/**
 * The breakdown grid: four measured panels, the spender list, and the invented
 * ones interleaved in the prototype's order.
 *
 * `fillWithSample` is the one rule the grid applies throughout — sample mode
 * fills a panel that has nothing and never displaces one holding real figures,
 * so a badge on this grid always means the panel beneath it is invented.
 */
function BreakdownGrid({
  interval,
  rows,
  sample,
  showSample,
  spenders,
}: {
  interval: TimeInterval;
  /** Every measured series, already folded and filtered. Null is unanswered. */
  rows: MeasuredRows;
  sample: SampleSeries;
  showSample: boolean;
  spenders: SpenderReadState;
}) {
  /** Whether sample figures stand in for this panel's own. */
  const invented = (measured: unknown[] | null) =>
    showSample && (measured === null || measured.length === 0);
  /** Those sample figures, or the measured ones when there are any. */
  const orSample = <T,>(measured: T[] | null, invented_: T[]): T[] | null =>
    invented(measured) ? invented_ : measured;

  return (
    <SimpleGrid columns={{ base: 1, xl: 3 }} gap={4}>
      {showSample && (
        <CostPanel title="Share of cost by agent" sample>
          <CostDonut rows={sample.agents} />
        </CostPanel>
      )}
      <CostPanel
        title="Cost over time · by team"
        sample={invented(rows.byTeam)}
      >
        <CostStackedBars
          buckets={orSample(rows.byTeam, sample.overTime)}
          interval={interval}
          empty={costPanelEmpty({
            what: "Spend per team, one bar per period.",
            source:
              "Fills from gateway traffic and from usage a connected source reports.",
            action: ADD_A_SOURCE,
          })}
        />
      </CostPanel>
      <CostPanel
        title="Cost by department"
        sample={invented(rows.byDepartment)}
      >
        <CostRankList
          rows={orSample(rows.byDepartment, sample.departments)}
          empty={costPanelEmpty({
            what: "Spend split across the departments people belong to.",
            source:
              "Fills once people who are spending are assigned to a department.",
            action: MANAGE_DEPARTMENTS,
          })}
        />
      </CostPanel>

      {showSample && (
        <CostPanel title="Cost by agent" sample>
          <CostRankList rows={sample.agents} />
        </CostPanel>
      )}
      <CostPanel title="Cost by model" sample={invented(rows.byModel)}>
        <CostRankList
          rows={orSample(rows.byModel, sample.models)}
          empty={costPanelEmpty({
            what: "Spend per model, largest first.",
            source:
              "Fills from gateway traffic and from usage rows that name a model.",
            action: ADD_A_SOURCE,
          })}
        />
      </CostPanel>
      {/* "Metered", not "Cost", because the panel below it also ranks people
          by money and the two figures are different money — this one is what
          the traffic measured as it was served, that one is what the provider
          put on the invoice. They disagree routinely, so each title has to
          name its lane or the pair reads as the same list rendered twice. */}
      <CostPanel title="Metered spend by person" sample={invented(rows.byUser)}>
        <CostRankList
          rows={orSample(rows.byUser, sample.users)}
          empty={costPanelEmpty({
            what: "Spend recorded against each person as their traffic was served.",
            source:
              "Fills from gateway traffic and from usage rows that name an actor.",
            action: ADD_A_SOURCE,
          })}
        />
      </CostPanel>
      <SpenderPanelSlot spenders={spenders} showSample={showSample} />

      {showSample && <SampleTailPanels sample={sample} interval={interval} />}
    </SimpleGrid>
  );
}

/**
 * The two count panels that close the grid, both invented.
 *
 * "Conversations", not "Genie questions". Genie is one of eight ingestion
 * sources (docs/ai-governance/overview.mdx) and no metric in the ADR or the
 * product docs is named after it; a panel named for one provider reads as
 * empty to every customer using another.
 *
 * The two panels count different KINDS of thing and are formatted apart on
 * purpose. Conversations are a tally — somebody could in principle count them,
 * and a reader comparing quarters wants the figure, so the axis spells it out.
 * Tokens are throughput nobody holds in their head, so that axis abbreviates.
 * Both used the abbreviating formatter until the conversations axis read
 * "4.6k" beside the token axis reading "3.4B", which made a few thousand
 * support chats look like a unit of machine consumption.
 */
function SampleTailPanels({
  sample,
  interval,
}: {
  sample: SampleSeries;
  interval: TimeInterval;
}) {
  return (
    <>
      <CostPanel title="Conversations over time" sample>
        <CostStackedBars
          buckets={sample.conversations}
          format={fmtWhole}
          interval={interval}
          showLegend={false}
        />
      </CostPanel>
      <CostPanel title="Tokens over time" sample>
        <CostLine points={sample.tokens} interval={interval} />
      </CostPanel>
    </>
  );
}

/**
 * Everything below the lanes: the adoption strip, the sample-only headline
 * pair, and the breakdown grid.
 *
 * The wire rows are mapped to chart rows here rather than in the grid because
 * this is where the department filter applies, and the mapping has to carry
 * null through: an unanswered read stays unanswered all the way to the panel
 * rather than turning into an empty list, which would read as a measurement.
 */
function CostBreakdowns({
  filters,
  breakdowns,
  periods,
  showSample,
  spenders,
  sourcesConnected: connected,
}: {
  filters: CostFilters;
  breakdowns: Breakdowns;
  /** The bucket starts the sample series are drawn on. */
  periods: string[];
  showSample: boolean;
  spenders: SpenderReadState;
  /** See `sourcesConnected`: the Adoption count cannot state its own absence. */
  sourcesConnected: boolean;
}) {
  const sample = useSampleSeries(periods, filters.interval, filters.department);
  const rows = measuredRows({ breakdowns, filters });

  return (
    <VStack align="stretch" gap={4}>
      <AdoptionRow
        breakdowns={breakdowns}
        showSample={showSample}
        sourcesConnected={connected}
      />
      {showSample && (
        <SampleHeadlinePanels sample={sample} interval={filters.interval} />
      )}
      <BreakdownGrid
        interval={filters.interval}
        rows={rows}
        sample={sample}
        showSample={showSample}
        spenders={spenders}
      />
    </VStack>
  );
}

/** The four measured series the grid draws. Null is an unanswered read. */
interface MeasuredRows {
  byTeam: DailyBucket[] | null;
  byDepartment: RankRow[] | null;
  byModel: RankRow[] | null;
  byUser: RankRow[] | null;
}

/**
 * A bucket series holding no figures at all, as the empty list it is.
 *
 * THE OVER-TIME READ ANSWERS A ROW PER DAY WHETHER OR NOT ANYTHING WAS SPENT.
 * A window with nothing in it therefore comes back as three hundred and
 * sixty-five buckets of nothing, and every emptiness test on this page is a
 * length check — so that read alone looked full while its neighbours looked
 * empty. The consequence was visible: with sample mode on, every panel around
 * "Cost over time · by team" filled with invented figures and that one panel
 * sat there saying "Nothing in this window yet", because a list of 365 empty
 * days is not an empty list.
 *
 * The ranked panels never had the bug — they total their series first, and a
 * total of nothing is genuinely nothing. This puts the bucket series on the
 * same footing rather than teaching every caller to ask a different question.
 *
 * Null in, null out: an unanswered read is not a measurement of an empty
 * window, and that distinction is the one thing the empty states turn on.
 */
function withoutEmptyBuckets(
  buckets: DailyBucket[] | null,
): DailyBucket[] | null {
  if (buckets === null) return null;
  const holdsAFigure = buckets.some((bucket) => bucket.points.length > 0);
  return holdsAFigure ? buckets : [];
}

/**
 * The wire rows, folded to the interval and narrowed by the department chip.
 *
 * Null carries all the way through: an unanswered read stays unanswered rather
 * than turning into an empty list, which the panel would report as a
 * measurement of an empty window.
 */
function measuredRows({
  breakdowns,
  filters,
}: {
  breakdowns: Breakdowns;
  filters: CostFilters;
}): MeasuredRows {
  return {
    byTeam:
      breakdowns.overTime === null
        ? null
        : withoutEmptyBuckets(
            aggregateBuckets(breakdowns.overTime, filters.interval),
          ),
    byDepartment:
      breakdowns.departmentRows === null
        ? null
        : breakdowns.departmentRows
            .filter(
              (row) =>
                filters.department === ALL_DEPARTMENTS ||
                (row.departmentId ?? "unassigned") === filters.department,
            )
            .map((row) => ({
              key: row.departmentId ?? "unassigned",
              label: row.departmentName,
              value: Number(row.spendUsd),
            })),
    byModel:
      breakdowns.modelOverTime === null
        ? null
        : totalPerSeries(breakdowns.modelOverTime),
    byUser:
      breakdowns.userRows === null
        ? null
        : breakdowns.userRows.map((row) => ({
            key: row.actor,
            label: row.actor,
            value: Number(row.spendUsd),
          })),
  };
}

/**
 * Adoption: how far AI tools have reached into the organization.
 *
 * Only the active-user count is measured today. In sample mode the panel shows
 * the four figures it is meant to hold rather than the word "Not available",
 * which named nothing and told the reader nothing about what would fill it.
 *
 * An interaction count used to sit beside the user count, summed from the
 * ranked user rows — but that read is a top-8, so the sum was the leaders'
 * share wearing the name of an organization-wide total. It is gone rather than
 * quietly wrong.
 */
/**
 * Whether any source is reporting, which is what the lanes and the adoption
 * count both need and neither should decide for itself.
 *
 * "Holds figures", not merely "answered". A read that came back with every
 * lane empty leaves the same blank screen a failed one does, and an
 * organization with a cost store configured but nothing flowing through it
 * answers exactly that way: `unavailableReason` null, every lane empty. The
 * structural reasons are the OTHER half — no governance project, no cost store
 * — and `summaryAsRead` already folds both into one length.
 *
 * The adoption headcount needs this because it is the one number on this page
 * that CANNOT state its own absence: the activity summary types
 * `activeUsersThisWindow` as a plain number and zero-fills it when nothing is
 * behind it, so "nobody used a tool" and "nothing is connected" arrive as the
 * same 0. The tempting fix — treat every 0 as unmeasured — is wrong the other
 * way: an organization with a source connected and a genuinely quiet quarter
 * has a true zero, and that IS the finding. So the question asked is
 * CONNECTEDNESS, never the count.
 *
 * One function rather than two because the lanes asked this first and the
 * screen has to agree with itself. It was the second, weaker copy of this test
 * — `unavailableReason` alone — that let the adoption card print "0" directly
 * beneath the page's own banner saying nothing had been recorded.
 */
// A type predicate rather than a plain boolean: holding figures implies the
// read answered, and the lane branch below draws from `data` on the strength of
// exactly that. Written as `boolean` it compiled everywhere except there.
function summaryHoldsFigures(
  data: GovernanceCostSummaryDto | undefined,
  isError: boolean,
): data is GovernanceCostSummaryDto {
  return (
    !!data &&
    !isError &&
    data.unavailableReason === null &&
    (summaryAsRead(data)?.length ?? 0) > 0
  );
}

function AdoptionRow({
  breakdowns,
  showSample,
  sourcesConnected: connected,
}: {
  breakdowns: Breakdowns;
  showSample: boolean;
  sourcesConnected: boolean;
}) {
  // Nobody is a measurement of nothing, the same way an empty list is. The
  // check used to be `=== null`, so an activity read that answered with zero
  // active users left this panel reading "0" in the middle of a screen full of
  // invented figures — one card claiming to have measured an organization that
  // the fifteen around it were busy inventing.
  const measured = breakdowns.activeUsers;
  const invented = showSample && !measured;

  return (
    <CostPanel title="Adoption" sample={invented}>
      <AdoptionFigures
        invented={invented}
        measured={measured}
        sourcesConnected={connected}
      />
    </CostPanel>
  );
}

/**
 * The adoption figures, invented or measured, in one shell.
 *
 * Sample mode chooses the DATA, never the panel: a sample-only panel that
 * happened to look like the real one is two components to keep in step, and
 * the day they drift the invented screen stops being a preview of anything.
 */
function AdoptionFigures({
  invented,
  measured,
  sourcesConnected: connected,
}: {
  invented: boolean;
  measured: number | null;
  sourcesConnected: boolean;
}) {
  if (invented) {
    const adoption = sampleAdoption();
    return (
      <HStack gap={10} align="flex-end" flexWrap="wrap">
        <Stat
          label="People using AI tools"
          value={numeral(adoption.peopleUsingAiTools).format("0,0")}
        />
        <Stat
          label="Active seats"
          value={numeral(adoption.activeSeats).format("0,0")}
        />
        <Stat
          label="Tools adopted"
          value={numeral(adoption.toolsAdopted).format("0,0")}
        />
        <Stat
          label="Change against previous period"
          value={`+${adoption.trendPct}%`}
        />
      </HStack>
    );
  }
  // Two ways to have no figure: the read never answered, or it answered with a
  // zero that no connected source stands behind. Both are unanswered in the
  // sense the panel cares about — nothing was measured — and both name the move
  // that would fill the card. See `sourcesConnected` for why the count itself
  // is never the test.
  if (measured === null || !connected) {
    return (
      <CostPanelEmpty
        unanswered
        height="72px"
        what="How many people used an AI tool in this period."
        source="Fills from the activity a connected source reports."
        action={ADD_A_SOURCE}
      />
    );
  }
  return (
    <HStack gap={10} align="flex-end">
      <Stat
        label="People using AI tools"
        value={numeral(measured).format("0,0")}
      />
    </HStack>
  );
}

/**
 * The bucket starts the sample series are drawn on.
 *
 * Months, because the finest interval any chip offers is a month, so a year of
 * invented days would be folded away before anything drew it. The frame's full
 * span is used rather than the clamped one: nothing here is a read, so the
 * ceiling that applies to reads does not apply, and a two-year frame shows two
 * years of sample.
 */
function useSamplePeriods(frame: TimeFrame): string[] {
  return useMemo(
    () => recentMonths(Math.max(1, Math.round(frameSpanDays({ frame }) / 30))),
    [frame],
  );
}

/**
 * How far the forecast reaches, per interval in view.
 *
 * A quarter ahead is the claim the panel wants to make, and at Month and
 * Quarter that is exactly what it makes. At YEAR it cannot: three projected
 * months fold into the same year bucket as the nine measured months before
 * them, and the bar that comes out holds spend and forecast added together
 * with nothing able to say which part is which. So a screen set to Year
 * reaches a year, where the projection gets a bucket of its own and the
 * measured years stay measured.
 *
 * The alternative was to draw no projection at Year, which is honest and
 * useless: the panel is named for a forecast and a reader who switched to
 * Year would find it had quietly stopped making one.
 */
const PROJECTION_MONTHS: Record<TimeInterval, number> = {
  month: 3,
  quarter: 3,
  year: 12,
};

/**
 * Every placeholder series the page needs, folded to the chosen interval and
 * narrowed to the chosen department.
 *
 * The department chip filters the invented series exactly as it filters the
 * real ones: a chip that changed nothing while the reader watched would be a
 * demonstration of a control that does not work.
 */
function useSampleSeries(
  periods: string[],
  interval: TimeInterval,
  department: string,
) {
  return useMemo(() => {
    const departments =
      department === ALL_DEPARTMENTS
        ? [...SAMPLE_DEPARTMENTS]
        : SAMPLE_DEPARTMENTS.filter((name) => name === department);

    // The two series every ranked panel is derived from, so a reader who adds
    // up the department bars gets the same figure the chart above them draws.
    const byDepartment = sampleDaily(periods, departments, SAMPLE_MONTHLY_TOP);
    const forecast = sampleForecast({
      days: periods,
      labels: SAMPLE_AGENTS.slice(0, 5),
      monthlyTopValue: SAMPLE_MONTHLY_TOP,
      monthsAhead: PROJECTION_MONTHS[interval],
    });

    return {
      // Ranked FROM the series rather than beside it. Generating both
      // independently is what made the old screen incoherent: the department
      // panel read $10.2k under a chart of the same money drawing $280k a
      // quarter, and a reader who noticed had learned only that the screen
      // does not add up.
      departments: totalPerSeries(byDepartment),
      // MEASURED ONLY. The forecast now runs a quarter past the end of the
      // window, and ranking agents by a total that included those months would
      // put money nobody has spent into a panel titled "Cost by agent".
      agents: totalPerSeries(forecast.measured),
      // These two have no series of their own on the page, so they are scaled
      // to the same window total by hand: a 0.42 decay sums to about 1.72x its
      // leader, which puts the leader near sixty per cent of the year.
      models: sampleRanked(SAMPLE_MODELS, SAMPLE_WINDOW_TOTAL * 0.58),
      users: sampleRanked(SAMPLE_PEOPLE, SAMPLE_WINDOW_TOTAL * 0.4),
      forecast: {
        // Measured months and projected months on one axis. The chart needs
        // them together — a forecast is only legible against what it continues
        // — and the fold is applied to the pair so a projected month cannot
        // land in a bucket the measured months were not folded into.
        buckets: aggregateBuckets(
          [...forecast.measured, ...forecast.projected],
          interval,
        ),
        // The marker is folded by the same function that keys the buckets, so
        // it lands on a bucket the chart actually draws at every interval.
        //
        // It used to be dropped instead at anything wider than a month, on the
        // grounds that a day marker cannot point at a quarter boundary it does
        // not fall on. True, and the wrong remedy: quarter is the default, so
        // the panel called "forecast" drew no forecast on the view almost
        // everyone sees, and the run-rate tail read as money already spent.
        //
        // Folding rounds DOWN, which puts the whole bucket holding the split
        // on the projected side. That bucket is part measured, so this
        // understates what is known — and never the reverse. Showing a
        // projection as spend is the lie worth engineering against; calling a
        // few measured days projected only costs the reader some certainty.
        projectedFromDay: forecast.projectedFromDay
          ? bucketStartOf(forecast.projectedFromDay, interval)
          : null,
      },
      overTime: aggregateBuckets(byDepartment, interval),
      seats: aggregateSeatCounts(sampleSeats(periods), interval),
      conversations: aggregateBuckets(
        sampleDaily(
          periods,
          SAMPLE_AGENTS.slice(0, 6),
          SAMPLE_CONVERSATIONS_TOP,
        ),
        interval,
      ),
      tokens: aggregateLine(
        sampleLine(periods, "tokens", 3_000_000_000),
        interval,
      ),
    };
  }, [periods, interval, department]);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <VStack align="flex-start" gap={0}>
      <Text fontSize="xs" color="fg.muted">
        {label}
      </Text>
      <Text fontSize="2xl" fontWeight="semibold" lineHeight="1.1">
        {value}
      </Text>
    </VStack>
  );
}

// Composed on top of the section-wide governance flag, never instead of it:
// flipping the section flag off still hides this page. The permission is
// `governanceCost:view` rather than `governance:view` — reading what the
// organization spends is its own capability, delegable without handing over
// the ingestion and anomaly admin surfaces.
export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withFeatureFlagGuard("release_ui_governance_billed_cost_enabled", {
    bypassOnboardingRedirect: true,
  })(
    withPermissionGuard("governanceCost:view", {
      bypassOnboardingRedirect: true,
    })(CostsPage),
  ),
);
