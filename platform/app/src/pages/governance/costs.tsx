import {
  Alert,
  Button,
  Heading,
  HStack,
  SimpleGrid,
  Skeleton,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type {
  GovernanceCostDayDto,
  GovernanceCostProviderDayRowDto,
  GovernanceCostSummaryDto,
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
import {
  azureBillingNoteSentence,
  laneTrendPct,
} from "~/components/governance/costLaneFormat";
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
import { CostProviderBreakdown } from "~/components/governance/costs/CostProviderBreakdown";
import {
  CostProviderDayPanel,
  costTotalBuckets,
  PartialSpendNote,
  partialProviderNotes,
} from "~/components/governance/costs/CostProviderDayPanel";
import {
  CostSpenderError,
  CostSpenderList,
  type SpenderRow,
} from "~/components/governance/costs/CostSpenderPanel";
import {
  isRefusedRead,
  summaryAsRead,
} from "~/components/governance/costs/costSampleMode";
import {
  ALL_DEPARTMENTS,
  aggregateBuckets,
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
  useSampleMode,
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
 * The screen's filter state, and the two ways it is allowed to change.
 *
 * The frame and the interval are not independent, which is why they move
 * together here rather than at the call site. Narrowing the frame can leave
 * the reader on an interval the new frame cannot draw — a quarter over three
 * months is one bar wearing a chart's clothes. `chooseFrame` steps down to the
 * widest interval that still fits, in one place so every governance page
 * answers alike.
 */
function useCostFilters() {
  const [filters, setFilters] = useState<CostFilters>({
    department: ALL_DEPARTMENTS,
    departmentName: null,
    frame: DEFAULT_TIME_FRAME,
    interval: DEFAULT_TIME_INTERVAL,
  });
  const patch = (next: Partial<CostFilters>) =>
    setFilters((current) => ({ ...current, ...next }));
  const chooseFrame = (frame: TimeFrame) =>
    patch({
      frame,
      interval: coerceInterval({ interval: filters.interval, frame }),
    });
  return { filters, setFilters, patch, chooseFrame };
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
    isFetching: spenders.isFetching,
    retry: () => void spenders.refetch(),
  };
}

function CostsPage() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const organizationId = organization?.id ?? "";
  const { filters, setFilters, patch, chooseFrame } = useCostFilters();

  const windowDays = windowDaysForFrame({ frame: filters.frame });

  const { summary, providerDays, breakdowns, spenders, busy, refresh } =
    useCostScreenReads({ organizationId, windowDays, hasAnyPermission });

  const { active: showSample, toggle: toggleSample } = useSampleMode();
  const samplePeriods = useSamplePeriods(filters.frame);

  useDepartmentSelectionReset({ filters, breakdowns, setFilters, showSample });

  const departmentOptions = showSample
    ? SAMPLE_DEPARTMENTS.map((name) => ({ id: name, name }))
    : breakdowns.departments;
  const holdsFigures = summaryHoldsFigures(summary.data, summary.isError);

  return (
    <GovernanceLayout pageTitle="Costs · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full">
        <CostsHeader
          lastReadAt={summary.dataUpdatedAt}
          busy={busy}
          onRefresh={refresh}
          showSample={showSample}
          onToggleSample={toggleSample}
        />
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
            organizationId={organizationId}
            providerDays={providerDays.data?.rows ?? null}
            hasProviderDaysFailure={providerDays.isError}
          />
        </SampleSaidOnce>
      </VStack>
    </GovernanceLayout>
  );
}

/**
 * Every read this screen issues, and the one control that runs them again.
 *
 * One place rather than five call sites, because the guarantees this screen
 * makes are about the SET: none of them polls, none re-reads on focus, and
 * refreshing runs all of them or the screen is half up to date. A read added
 * next to its neighbours here is a read the refresh cannot silently miss.
 */
function useCostScreenReads({
  organizationId,
  windowDays,
  hasAnyPermission,
}: {
  organizationId: string;
  windowDays: number;
  hasAnyPermission: (
    permission: "activityMonitor:view" | "governance:view",
  ) => boolean;
}) {
  const { summary, providerDays } = useLaneReads({
    organizationId,
    windowDays,
  });
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
  return {
    summary,
    providerDays,
    breakdowns,
    spenders,
    // EVERY read the refresh runs, not most of them. `refresh` re-runs the
    // spender read too, so leaving it out drops `aria-busy` while that one is
    // still in flight — and a reader who sees the control go quiet with the
    // panel unchanged clicks it again, which is the thing the busy state is on
    // the page to prevent.
    busy:
      summary.isFetching ||
      providerDays.isFetching ||
      breakdowns.isFetching ||
      spenders.isFetching,
    refresh: () =>
      refreshEveryRead({ summary, providerDays, spenders, breakdowns }),
  };
}

/**
 * The two reads the lanes and the day split are drawn from.
 *
 * Neither polls and neither re-reads when the reader returns to the window.
 * That rule is stated HERE, at each call site, rather than inherited from the
 * global query defaults: another governance screen already overrides that
 * global to re-read on focus, so a money read that does not say the rule
 * itself is one edit away from polling by accident — and the edit would be
 * made in a different file by somebody with no reason to think about this
 * screen. Figures that move under a reader mid-decision, often with the window
 * shared, are worse than figures they chose to bring up to date.
 */
function useLaneReads({
  organizationId,
  windowDays,
}: {
  organizationId: string;
  windowDays: number;
}) {
  const options = {
    enabled: !!organizationId,
    refetchOnWindowFocus: false as const,
  };
  const args = { organizationId, windowDays };
  return {
    summary: api.governanceCost.summary.useQuery(args, options),
    providerDays: api.governanceCost.dailyByProvider.useQuery(args, options),
  };
}

/**
 * Bringing every figure on this screen up to date, by name.
 *
 * The set is NAMED rather than counted. The collection warning rides the
 * summary read and the figures ride the others, and a figure brought up to
 * date beside a stalled warning that was not is a worse screen than one where
 * both are old together — so the absence of any single name here is a screen
 * that half-refreshes, and a count would not say which one went missing.
 *
 * Each read is asked to run again directly rather than having its cache key
 * invalidated. Both reissue the read; asking the query objects this screen
 * already holds keeps the list of what gets refreshed in the same place as the
 * list of what gets read, where a new read added to one and forgotten in the
 * other is visible.
 *
 * The records behind a day are deliberately absent: that read is issued only
 * once a reader opens a day, and re-running a read nothing is showing would be
 * work for nobody.
 */
function refreshEveryRead({
  summary,
  providerDays,
  spenders,
  breakdowns,
}: {
  summary: { refetch: () => unknown };
  providerDays: { refetch: () => unknown };
  spenders: SpenderReadState;
  breakdowns: Breakdowns;
}) {
  summary.refetch();
  providerDays.refetch();
  spenders.retry();
  breakdowns.refetchAll();
}

/**
 * The page's title row: what it is, how old the figures are, and the two
 * controls that change either.
 *
 * The controls are SIBLINGS of the heading rather than nested in a group of
 * their own. The sample toggle sits beside the heading by design, and a
 * wrapper around it would put it in a different row as far as anything reading
 * the page structure is concerned.
 */
function CostsHeader({
  lastReadAt,
  busy,
  onRefresh,
  showSample,
  onToggleSample,
}: {
  /** When the summary read's answer arrived, epoch ms. */
  lastReadAt: number | undefined;
  /** Whether the reads are in flight, so the control can say it is working. */
  busy: boolean;
  onRefresh: () => void;
  showSample: boolean;
  onToggleSample: () => void;
}) {
  return (
    <HStack align="center" gap={3}>
      <Heading size="md">Costs</Heading>
      <Spacer />
      <FiguresLastRead at={lastReadAt} />
      {/* `aria-busy` rather than a disabled control: a reader who sees nothing
          move clicks again, and a button that goes dead says nothing about
          why. */}
      <Button size="xs" variant="outline" aria-busy={busy} onClick={onRefresh}>
        Refresh
      </Button>
      <SampleDataToggle active={showSample} onToggle={onToggleSample} />
    </HStack>
  );
}

/**
 * When the figures on this screen were last read.
 *
 * An ABSOLUTE clock time, in the reader's own local time, never "9 hours ago".
 * A relative phrase goes stale the moment it is rendered and has to be
 * re-rendered to stay true, which is exactly the self-refreshing behaviour
 * this screen refuses; and the reader's real question — is this older than the
 * pull I am waiting on — is a comparison of two instants, which only an
 * absolute reading makes legible.
 *
 * Taken from when the ANSWER arrived, never from the render: a stamp on the
 * render says when the page was opened, which tells a reader nothing about how
 * old the money is.
 */
function FiguresLastRead({ at }: { at: number | undefined }) {
  if (!at) return null;
  return (
    <Text
      fontSize="xs"
      color="fg.muted"
      data-testid="cost-figures-last-read"
      fontVariantNumeric="tabular-nums"
    >
      Last read{" "}
      {new Date(at).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </Text>
  );
}

/**
 * What a panel says when its read failed rather than answering nothing.
 *
 * Every panel here renders an unanswered read and an absent figure the same
 * way, so without this a failed refresh lands as a blank beside freshly filled
 * neighbours and reads as no spend. The two states ask the reader for opposite
 * things: an empty window is a finding, a failed read is something to try
 * again.
 */
function CostPanelUnrefreshed({ height = "220px" }: { height?: string }) {
  return (
    <VStack
      data-testid="cost-panel-unrefreshed"
      align="start"
      justify="center"
      height={height}
      gap={1}
      color="fg.muted"
    >
      <Text fontSize="sm" color="fg">
        This panel could not be brought up to date.
      </Text>
      <Text fontSize="sm">
        Its figures were not read, so none are shown. Refreshing again is worth
        a try.
      </Text>
    </VStack>
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
  const holdsFigures = summaryHoldsFigures(data, isError);
  if (showSample) {
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
  // Trends use daily rollup totals; provider bars and the billed headline
  // share their own window read so ongoing ingestion cannot split them.
  const seriesOf = (pick: (day: GovernanceCostDayDto) => number | null) =>
    data.series.map((day) => ({ day: day.day, value: pick(day) }));
  // Measured on the UNFOLDED series. The badge compares two spans and cannot
  // have buckets, because a bucket is whatever number of days the calendar
  // left in it. Folding first made a year of unchanged spend report growth on
  // every day the page could be opened, the size of it set by which quarter
  // today happened to fall in.
  const trendPctOf = (pick: (day: GovernanceCostDayDto) => number | null) =>
    laneTrendPct(seriesOf(pick));
  return (
    <VStack align="stretch" gap={6}>
      <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
        <CostLanePanel
          testId="cost-lane-billed"
          label="Billed by provider"
          description="Provider-reported costs recorded for this period."
          amountUsd={data.billed.amountUsd}
          cellsWithoutAmount={data.billed.cellsWithoutAmount}
          currenciesWithoutUsdAmount={data.billed.currenciesWithoutUsdAmount}
          currencyTotals={data.billed.currencyTotals}
          laneNote={
            data.azureBilling
              ? azureBillingNoteSentence(data.azureBilling)
              : null
          }
          trendPct={trendPctOf((day) => day.billedUsd)}
          sample={sample}
        >
          <CostProviderBreakdown providers={data.providers ?? []} />
        </CostLanePanel>
        <CostLanePanel
          testId="cost-lane-gateway"
          label="Metered by gateway"
          description="What the gateway measured as it served your traffic."
          amountUsd={data.gateway.amountUsd}
          cellsWithoutAmount={data.gateway.cellsWithoutAmount}
          currenciesWithoutUsdAmount={data.gateway.currenciesWithoutUsdAmount}
          currencyTotals={data.gateway.currencyTotals}
          trendPct={trendPctOf((day) => day.gatewayUsd)}
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
  /**
   * Model spend from the PULLED rollup, not from metered traces.
   *
   * Ranked rows rather than a bucket series because the panel is a ranked list:
   * it never drew the days, so carrying them here only meant re-totalling them
   * on every render. `amountUsd` is null when the figure is WITHHELD — some
   * cell behind that model holds no USD amount — which is not the same as zero
   * and must not be summed as one.
   */
  modelRows: Array<{
    model: string;
    amountUsd: number | null;
    cellsWithoutAmount: number;
  }> | null;
  /**
   * Which of these reads FAILED, as opposed to answering nothing.
   *
   * Carried apart from the rows because every panel here renders an
   * unanswered read and an absent figure the same way, so a failed read would
   * otherwise land as a blank beside freshly filled neighbours and read as no
   * spend. `null` rows are what the panel draws its empty state from; this is
   * what stops it drawing one at all.
   */
  failed: {
    byDepartment: boolean;
    byUser: boolean;
    byModel: boolean;
  };
  /** Whether any of them is currently in flight, for the refresh control. */
  isFetching: boolean;
  /** Ask every one of them to run again. See the refresh control's comment. */
  refetchAll: () => void;
}

/**
 * The reads under the breakdown panels.
 *
 * THE BY-TEAM CHART IS GONE and its read with it. `activityMonitor
 * .spendOverTime` grouped by team was the last caller of the metered trace
 * store on this screen's time axis, and it drew a chart nobody could act on:
 * a team is not a thing this product's cost rows carry, so every bar it ever
 * drew outside sample mode was one unattributed block. The panel was removed
 * at the product owner's direction and the read went with it rather than
 * staying to be paid for on every page load.
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
  // The PULLED rollup, not the metered trace store the panels around it read.
  // ADR-128 §1 files the model under wave 1 because the bill already carries
  // it, and it is the only one of wave 1's "where" dimensions that pulled rows
  // actually fill — so this panel can be a measurement while its neighbours
  // wait on gateway traffic (by team, by person) or on wave 2 (by department).
  // Pointed at the traces it reported "nothing in this window yet" over a
  // table holding every model the organization had been billed for.
  const byModel = api.governanceCost.spendByModel.useQuery(args, options);

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
    failed: {
      byDepartment: byDepartment.isError,
      byUser: byUser.isError,
      byModel: byModel.isError,
    },
    isFetching:
      summary.isFetching ||
      byDepartment.isFetching ||
      byUser.isFetching ||
      byModel.isFetching,
    refetchAll: () => {
      // Every read, including the model one that now comes from a different
      // router than its neighbours: refreshing some panels and leaving others
      // stale is the half-refresh this control exists against, and which
      // procedure a panel happens to call is not a reason to skip it.
      void summary.refetch();
      void byDepartment.refetch();
      void byUser.refetch();
      void byModel.refetch();
    },
    // `.rows`, and only once the read has answered: an unanswered read stays
    // null so the panel draws its empty state rather than a measured zero.
    modelRows: byModel.data?.rows ?? null,
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
  /** Whether it is in flight, for the refresh control. Same reason as the rest. */
  isFetching: boolean;
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
 * The panels below that HAVE NO READ BEHIND THEM YET.
 *
 * Four panels existed only under sample mode — the two agent breakdowns, the
 * agent forecast, and the conversation and token counts — so a reader who
 * turned the sample off watched half the screen disappear and had no way to
 * tell a panel that is coming from a panel that was never there. They are
 * drawn in both modes now, and outside sample mode they draw their empty
 * state.
 *
 * AN EMPTY ARRAY, NOT NULL, AND THAT IS A DELIBERATE OVERSTATEMENT. Null on
 * this screen means "no read has answered" and an empty array means "a read
 * answered and found nothing", and these panels are in the first state while
 * saying the second. It is the wording the product owner asked for, and it is
 * true of the store as it stands — the cost rollup carries an agent column
 * that is blank on every row it holds, and the metered lane these counts
 * would come from holds no rows at all — so "nothing in this window yet" is
 * not a lie about the money today. It WILL become one the day either of those
 * fills, because nothing here is measuring anything. Whoever wires the read
 * takes this constant out with it.
 */
const AWAITING_A_READ: [] = [];

/**
 * The same user-grouped panel for real data, samples, empty and failed reads.
 * Provider-reported cost stays separate from costs recorded on traces.
 */
const PROVIDER_REPORTED_BY_USER = "Provider-reported spend by user";

function SpenderPanelSlot({
  spenders,
  showSample,
}: {
  spenders: SpenderReadState;
  showSample: boolean;
}) {
  const measured =
    spenders.rows !== null && spenders.rows.length > 0 ? spenders.rows : null;
  const invented = showSample;
  const rows = showSample ? sampleSpenderRows() : measured;

  return (
    <CostPanel title={PROVIDER_REPORTED_BY_USER} sample={invented}>
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
      what="Cost grouped by the user the provider reports. Shared-key activity may belong to more than one person."
      source="Fills once a cost source reports users. Spend without a reported user stays unattributed."
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
function HeadlinePanels({
  sample,
  interval,
  showSample,
}: {
  sample: SampleSeries;
  interval: TimeInterval;
  showSample: boolean;
}) {
  return (
    <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
      {/*
        "Metered spend", not "consumption": the gateway lane above is labelled
        "Metered by gateway" and ADR-128 §2 calls this money gateway metering
        throughout. A screen that names the same money two ways teaches the
        reader they are two things.
      */}
      <CostPanel title="Metered spend forecast · by agent" sample={showSample}>
        <CostForecastArea
          buckets={showSample ? sample.forecast.buckets : AWAITING_A_READ}
          projectedFromDay={
            showSample ? sample.forecast.projectedFromDay : null
          }
          interval={interval}
          empty={costPanelEmpty({
            what: "Where metered spend per agent is heading, period by period.",
            ...AGENTS_ARE_UNATTRIBUTED,
          })}
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
      <CostPanel title="Seats · bought against assigned" sample={showSample}>
        {/* Whole numbers, like the conversations panel: a seat is a thing
            somebody was given, and "1.2k seats" is not how a licence count is
            ever discussed.

            Explicit colours because the two series are the panel: bought and
            assigned hashed to two blues that had to be told apart by reading
            the legend, on the one chart whose whole content is the gap between
            them. Bought is the outline of what is paid for and assigned is
            what is used, so the used half carries the stronger colour. */}
        <CostStackedBars
          buckets={showSample ? sample.seats : AWAITING_A_READ}
          format={fmtWhole}
          interval={interval}
          colorFor={(key) => SEAT_SERIES_COLORS[key]}
          grouped
          empty={costPanelEmpty({
            what: "Seats bought against seats assigned, period by period.",
            source: "Fills once seat licences are collected from a source.",
            action: ADD_A_SOURCE,
          })}
        />
      </CostPanel>
    </SimpleGrid>
  );
}

/**
 * Spend per person as the gateway measured it.
 *
 * "Metered", not "Cost", because the panel beside it also ranks people by
 * money and the two figures are different money — this one is what the
 * traffic measured as it was served, that one is what the provider put on the
 * invoice. They disagree routinely, so each title has to name its lane or the
 * pair reads as the same list rendered twice.
 */
function MeteredPersonPanel({
  rows,
  sample,
  showSample,
  unrefreshed,
}: {
  rows: RankRow[] | null;
  sample: SampleSeries;
  showSample: boolean;
  unrefreshed: boolean;
}) {
  return (
    <CostPanel title="Metered spend by person" sample={showSample}>
      {unrefreshed ? (
        <CostPanelUnrefreshed />
      ) : (
        <CostRankList
          rows={showSample ? sample.users : rows}
          empty={costPanelEmpty({
            what: "Spend recorded against each person as their traffic was served.",
            source:
              "Fills from gateway traffic and from usage rows that name an actor.",
            action: ADD_A_SOURCE,
          })}
        />
      )}
    </CostPanel>
  );
}

/**
 * What the organization spent, period by period, with nothing split out.
 *
 * The panel that used to sit here charted spend by TEAM, and a team is not a
 * dimension this product's cost rows carry — so outside sample mode every bar
 * it ever drew was one unattributed block, and the read behind it went to the
 * metered trace store for the privilege. It was removed with its read.
 *
 * This replaces it from the rows the screen already has. `dailyByProvider`
 * answers a figure per (day, provider); adding the providers up per period is
 * the whole of this chart, so it costs no query and cannot disagree with the
 * stacked panel beside it about any period.
 */
function CostTotalPanel({
  providerDays,
  hasFailure,
  interval,
  sample,
  showSample,
}: {
  providerDays: readonly GovernanceCostProviderDayRowDto[] | null;
  hasFailure: boolean;
  interval: TimeInterval;
  sample: SampleSeries;
  showSample: boolean;
}) {
  const measured = useMemo(
    () =>
      providerDays === null ? null : costTotalBuckets(providerDays, interval),
    [providerDays, interval],
  );
  // A period short in the provider split beside this is short here too —
  // same rows, same fold — and both panels say so in the same words. A bar
  // drawn at the sum of the days that held a figure reads as a cheap period
  // unless something says the figure is not whole; the bar is drawn short
  // (see `CostStackedBars`) and this line says who left it short.
  const partialProviders = useMemo(
    () => (providerDays === null ? [] : partialProviderNotes(providerDays)),
    [providerDays],
  );
  return (
    <CostPanel title="Cost over time" sample={showSample}>
      {!showSample && hasFailure ? (
        <CostPanelUnrefreshed />
      ) : (
        <VStack align="stretch" gap={2}>
          <CostStackedBars
            buckets={showSample ? sample.overTime : measured}
            interval={interval}
            // The measured chart is ONE series and the axis already says it
            // is money, so a legend there spends a line repeating the panel's
            // own title. The invented one still carries several, and those do
            // need naming.
            showLegend={showSample}
            empty={costPanelEmpty({
              what: "What was spent, period by period.",
              source: "Fills from the bills a connected source reports.",
              action: ADD_A_SOURCE,
            })}
          />
          {!showSample && <PartialSpendNote providers={partialProviders} />}
        </VStack>
      )}
    </CostPanel>
  );
}

/**
 * The provider split, or the marker that says its read did not answer.
 *
 * Beside `Cost over time · by team` on purpose: the two are the same chart
 * over the same axis, one split by who spent and one by who billed, and
 * reading them as a pair is how a period that stood out gets attributed.
 *
 * In sample mode it stands down entirely, unlike the panels around it. There
 * is no invented provider series to draw — the sample set has agents, teams
 * and departments and no providers — and an empty panel sitting between two
 * full ones reads as a provider nobody used rather than as a gap in what was
 * invented.
 */
function ProviderPanelSlot({
  organizationId,
  providerDays,
  hasFailure,
  interval,
  showSample,
}: {
  organizationId: string;
  providerDays: readonly GovernanceCostProviderDayRowDto[] | null;
  hasFailure: boolean;
  interval: TimeInterval;
  showSample: boolean;
}) {
  if (showSample) return null;
  if (hasFailure) {
    return (
      <CostPanel title="Cost over time · by provider">
        <CostPanelUnrefreshed />
      </CostPanel>
    );
  }
  if (providerDays === null || providerDays.length === 0) return null;
  return (
    <CostPanel title="Cost over time · by provider">
      <CostProviderDayPanel
        organizationId={organizationId}
        rows={providerDays}
        interval={interval}
      />
    </CostPanel>
  );
}

/**
 * What the agent panels say while nothing attributes spend to an agent.
 *
 * One sentence, three panels. Each of them is blank for the same reason and
 * fills on the same event, and three copies of that sentence is three places
 * for it to drift out of agreement with the other two.
 */
const AGENTS_ARE_UNATTRIBUTED = {
  source: "Fills once a source reports which agent spent the money.",
  action: ADD_A_SOURCE,
} as const;

/**
 * The two agent breakdowns, which have no read behind them yet.
 *
 * Extracted from the grid rather than inlined for the reason the file splits
 * `SpenderPanelSlot` out: each is a panel plus five lines of empty copy, and
 * the two of them inlined pushed the grid past the length the linter allows
 * and buried the shape of the grid under the wording of its cells. See
 * `AWAITING_A_READ` for what their empty state is claiming and what it is not.
 */
function AgentSharePanel({
  sample,
  showSample,
}: {
  sample: SampleSeries;
  showSample: boolean;
}) {
  return (
    <CostPanel title="Share of cost by agent" sample={showSample}>
      <CostDonut
        rows={showSample ? sample.agents : AWAITING_A_READ}
        empty={costPanelEmpty({
          what: "How the spend splits across the agents that ran it.",
          ...AGENTS_ARE_UNATTRIBUTED,
        })}
      />
    </CostPanel>
  );
}

function AgentRankPanel({
  sample,
  showSample,
}: {
  sample: SampleSeries;
  showSample: boolean;
}) {
  return (
    <CostPanel title="Cost by agent" sample={showSample}>
      <CostRankList
        rows={showSample ? sample.agents : AWAITING_A_READ}
        empty={costPanelEmpty({
          what: "Spend per agent, largest first.",
          ...AGENTS_ARE_UNATTRIBUTED,
        })}
      />
    </CostPanel>
  );
}

/**
 * The breakdown grid: four measured panels, the spender list, and the invented
 * ones interleaved in the prototype's order.
 *
 * Sample mode replaces every measured series in the grid.
 */
function BreakdownGrid({
  interval,
  rows,
  failed,
  sample,
  showSample,
  spenders,
  organizationId,
  providerDays,
  hasProviderDaysFailure,
}: {
  interval: TimeInterval;
  /** Every measured series, already folded and filtered. Null is unanswered. */
  rows: MeasuredRows;
  /** Which reads FAILED, as opposed to answering nothing. */
  failed: Breakdowns["failed"];
  sample: SampleSeries;
  showSample: boolean;
  spenders: SpenderReadState;
  organizationId: string;
  /**
   * One figure per (day, provider) of the billed lane. NULL UNTIL THE READ
   * ANSWERS, which an empty list cannot say on its own: the panels below
   * draw an unanswered read and a measured-empty window in different
   * words, and collapsing the two here would have them state a finding
   * nobody measured.
   */
  providerDays: readonly GovernanceCostProviderDayRowDto[] | null;
  /**
   * Whether that read FAILED, which an empty row list cannot say on its own.
   * Without it a failed read is an empty list, an empty list hides the panel,
   * and a hidden panel beside filled neighbours reads as no spend — the same
   * confusion `CostPanelUnrefreshed` exists to prevent.
   */
  hasProviderDaysFailure: boolean;
}) {
  const orSample = <T,>(measured: T[] | null, samples: T[]): T[] | null =>
    showSample ? samples : measured;
  // Sample mode outranks a failed read: the reader asked to be shown invented
  // figures, and a failure notice over the top of them would be reporting on a
  // read this screen is not currently showing.
  const unrefreshed = (which: keyof Breakdowns["failed"]) =>
    !showSample && failed[which];

  return (
    <SimpleGrid columns={{ base: 1, xl: 3 }} gap={4}>
      <AgentSharePanel sample={sample} showSample={showSample} />
      <CostTotalPanel
        providerDays={providerDays}
        hasFailure={hasProviderDaysFailure}
        interval={interval}
        sample={sample}
        showSample={showSample}
      />
      <ProviderPanelSlot
        organizationId={organizationId}
        providerDays={providerDays}
        hasFailure={hasProviderDaysFailure}
        interval={interval}
        showSample={showSample}
      />
      <CostPanel title="Cost by department" sample={showSample}>
        {unrefreshed("byDepartment") ? (
          <CostPanelUnrefreshed />
        ) : (
          <CostRankList
            rows={orSample(rows.byDepartment, sample.departments)}
            empty={costPanelEmpty({
              what: "Spend split across the departments people belong to.",
              source:
                "Fills once people who are spending are assigned to a department.",
              action: MANAGE_DEPARTMENTS,
            })}
          />
        )}
      </CostPanel>

      <AgentRankPanel sample={sample} showSample={showSample} />
      <CostPanel title="Cost by model" sample={showSample}>
        {unrefreshed("byModel") ? (
          <CostPanelUnrefreshed />
        ) : (
          <CostRankList
            rows={orSample(rows.byModel, sample.models)}
            empty={costPanelEmpty({
              what: "Spend per model, largest first.",
              // The billed lane only, so the copy no longer promises gateway
              // traffic will fill it: this read is the same rollup the billed
              // panels use, and naming a source that cannot feed it is the
              // kind of advice that leaves a reader waiting on nothing.
              source: "Fills from the bills a connected source reports.",
              action: ADD_A_SOURCE,
            })}
          />
        )}
      </CostPanel>
      <MeteredPersonPanel
        rows={rows.byUser}
        sample={sample}
        showSample={showSample}
        unrefreshed={unrefreshed("byUser")}
      />
      <SpenderPanelSlot spenders={spenders} showSample={showSample} />

      <CountPanels
        sample={sample}
        interval={interval}
        showSample={showSample}
      />
    </SimpleGrid>
  );
}

/**
 * The two count panels that close the grid.
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
function CountPanels({
  sample,
  interval,
  showSample,
}: {
  sample: SampleSeries;
  interval: TimeInterval;
  showSample: boolean;
}) {
  return (
    <>
      <CostPanel title="Conversations over time" sample={showSample}>
        <CostStackedBars
          buckets={showSample ? sample.conversations : AWAITING_A_READ}
          format={fmtWhole}
          interval={interval}
          showLegend={false}
          empty={costPanelEmpty({
            what: "How many conversations were held, period by period.",
            source: "Fills from traffic the gateway serves.",
            action: ADD_A_SOURCE,
          })}
        />
      </CostPanel>
      <CostPanel title="Tokens over time" sample={showSample}>
        <CostLine
          points={showSample ? sample.tokens : AWAITING_A_READ}
          interval={interval}
          empty={costPanelEmpty({
            what: "How many tokens were spent, period by period.",
            source: "Fills from traffic the gateway serves.",
            action: ADD_A_SOURCE,
          })}
        />
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
  organizationId,
  providerDays,
  hasProviderDaysFailure,
}: {
  filters: CostFilters;
  breakdowns: Breakdowns;
  /** The bucket starts the sample series are drawn on. */
  periods: string[];
  showSample: boolean;
  spenders: SpenderReadState;
  /** See `sourcesConnected`: the Adoption count cannot state its own absence. */
  sourcesConnected: boolean;
  organizationId: string;
  /**
   * One figure per (day, provider) of the billed lane. NULL UNTIL THE READ
   * ANSWERS, which an empty list cannot say on its own: the panels below
   * draw an unanswered read and a measured-empty window in different
   * words, and collapsing the two here would have them state a finding
   * nobody measured.
   */
  providerDays: readonly GovernanceCostProviderDayRowDto[] | null;
  /**
   * Whether that read FAILED, which an empty row list cannot say on its own.
   * Without it a failed read is an empty list, an empty list hides the panel,
   * and a hidden panel beside filled neighbours reads as no spend — the same
   * confusion `CostPanelUnrefreshed` exists to prevent.
   */
  hasProviderDaysFailure: boolean;
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
      <HeadlinePanels
        sample={sample}
        interval={filters.interval}
        showSample={showSample}
      />
      <BreakdownGrid
        interval={filters.interval}
        rows={rows}
        failed={breakdowns.failed}
        sample={sample}
        showSample={showSample}
        spenders={spenders}
        organizationId={organizationId}
        providerDays={providerDays}
        hasProviderDaysFailure={hasProviderDaysFailure}
      />
    </VStack>
  );
}

/**
 * The ranked model list's key for rows the provider named no model on.
 *
 * A key of its own rather than the empty string: the list keys its rows, and
 * "" is falsy in enough of the places a key travels through that a row with
 * one is a bug waiting for a re-render. The LABEL beside it says no model was
 * named rather than inventing one, the same honesty the spender panel's
 * not-named bucket keeps.
 */
const UNNAMED_MODEL_KEY = "__no_model__";

/** The four measured series the grid draws. Null is an unanswered read. */
interface MeasuredRows {
  byDepartment: RankRow[] | null;
  byModel: RankRow[] | null;
  byUser: RankRow[] | null;
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
    // Already totalled by the service. A model the provider named nothing
    // for keeps an honest label rather than an invented one, the same choice
    // the spender panel makes for its not-named bucket.
    //
    // A WITHHELD figure is LISTED, not dropped. The money was billed, so a
    // list that leaves the model out reports a smaller bill than the provider
    // sent — and a window whose models were all withheld emptied the panel
    // into "nothing in this window yet", which claims a measurement the
    // screen does not have. It carries a stand-in zero and the flag that says
    // so: `CostRankList` draws no bar for it and prints no figure, and the
    // cells-without-amount count is what its hover explains it with.
    byModel:
      breakdowns.modelRows === null
        ? null
        : breakdowns.modelRows.map((row) => ({
            key: row.model === "" ? UNNAMED_MODEL_KEY : row.model,
            label: row.model === "" ? "No model named" : row.model,
            value: row.amountUsd ?? 0,
            unpriced: row.amountUsd === null,
            unpricedCells: row.cellsWithoutAmount,
          })),
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
  const measured = breakdowns.activeUsers;
  const invented = showSample;

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
