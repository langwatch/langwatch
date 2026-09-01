import {
  Alert,
  Heading,
  HStack,
  SimpleGrid,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { GovernanceCostSummaryDto } from "@ee/governance/services/governanceCost.service";
import numeral from "numeral";
import { useMemo, useState } from "react";

import {
  CostLanePanel,
  SeatLanePanel,
} from "~/components/governance/CostLanePanel";
import { CostLanesChart } from "~/components/governance/CostLanesChart";
import {
  CostDonut,
  CostForecastArea,
  CostLine,
  CostRankList,
  CostStackedBars,
  fmtCount,
} from "~/components/governance/costs/CostCharts";
import { CostFilterBar } from "~/components/governance/costs/CostFilterBar";
import { CostPanel } from "~/components/governance/costs/CostPanel";
import {
  CostSampleBanner,
  CostSampleToggle,
} from "~/components/governance/costs/CostSampleControls";
import {
  resolveRealDataState,
  sampleModeActive,
} from "~/components/governance/costs/costSampleMode";
import {
  ALL_DEPARTMENTS,
  aggregateBuckets,
  aggregateLine,
  type GroupBy,
  type TimeInterval,
} from "~/components/governance/costs/costsWindow";
import {
  type DailyBucket,
  type RankRow,
  recentDays,
  SAMPLE_AGENTS,
  SAMPLE_DEPARTMENTS,
  sampleDaily,
  sampleForecast,
  sampleLine,
  sampleRanked,
} from "~/components/governance/costs/sampleSeries";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
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
 * The breakdowns below the lanes are a mix. Cost over time, cost by
 * department, cost by model and cost by user are real reads. Agents, prepaid
 * seats, forecasts, token counts and Genie questions have no backing read yet
 * and are drawn from `sampleSeries`, each badged `sample`.
 *
 * Those invented panels do not render unconditionally. They fill a screen with
 * nothing measured on it, step aside once real figures arrive, and the reader
 * can overrule either default from the toggle in the header — the same
 * arrangement the trace explorer uses for its sample traces. See
 * `costSampleMode.ts` for why an unanswered read is not treated as an empty
 * one.
 *
 * Spec: specs/governance/governance-cost-screen.feature (ADR-128)
 */

interface CostFilters {
  department: string;
  windowDays: number;
  interval: TimeInterval;
  groupBy: GroupBy;
}

function CostsPage() {
  const { organization, hasAnyPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const organizationId = organization?.id ?? "";
  const [filters, setFilters] = useState<CostFilters>({
    department: ALL_DEPARTMENTS,
    windowDays: 30,
    interval: "day",
    groupBy: "team",
  });
  const patch = (next: Partial<CostFilters>) =>
    setFilters((current) => ({ ...current, ...next }));

  const summary = api.governanceCost.summary.useQuery(
    { organizationId, windowDays: filters.windowDays },
    { enabled: !!organizationId },
  );
  const breakdowns = useBreakdownQueries({
    organizationId,
    windowDays: filters.windowDays,
    groupBy: filters.groupBy,
    // The page opens on `governanceCost:view`, but the breakdowns read the
    // activity monitor, which is its own grant. A viewer holding one and not
    // the other gets the lanes and no failed queries underneath them.
    enabled: !!organizationId && hasAnyPermission("activityMonitor:view"),
  });

  // `null` until the reader picks a side, which is what lets the default below
  // follow the data. Deliberately not persisted: the same rule the trace
  // explorer applies to its sample traces — opting in is a decision about this
  // sitting, not a preference that follows you back tomorrow.
  const [sampleOptIn, setSampleOptIn] = useState<boolean | null>(null);
  const showSample = sampleModeActive({
    optIn: sampleOptIn,
    realData: resolveRealDataState([
      breakdowns.departmentRows,
      breakdowns.userRows,
      breakdowns.overTime,
      breakdowns.modelOverTime,
    ]),
  });

  return (
    <GovernanceLayout pageTitle="Costs · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full">
        <HStack justify="space-between" align="center">
          <Heading size="md">Costs</Heading>
          <CostSampleToggle
            active={showSample}
            onToggle={() => setSampleOptIn(!showSample)}
          />
        </HStack>
        {showSample && <CostSampleBanner />}
        <CostFilterBar
          department={filters.department}
          departments={breakdowns.departments}
          onDepartmentChange={(department) => patch({ department })}
          windowDays={filters.windowDays}
          onWindowDaysChange={(windowDays) => patch({ windowDays })}
          interval={filters.interval}
          onIntervalChange={(interval) => patch({ interval })}
          groupBy={filters.groupBy}
          onGroupByChange={(groupBy) => patch({ groupBy })}
        />

        <CostsBody
          isLoading={summary.isLoading && !!organizationId}
          isError={summary.isError}
          data={summary.data}
        />

        <CostBreakdowns
          filters={filters}
          breakdowns={breakdowns}
          showSample={showSample}
        />
      </VStack>
    </GovernanceLayout>
  );
}

/**
 * The body's four states, kept in one place so no branch can quietly acquire a
 * zero: loading, failed read, unavailable, and figures.
 */
function CostsBody({
  isLoading,
  isError,
  data,
}: {
  isLoading: boolean;
  isError: boolean;
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

  if (data.unavailableReason !== null) {
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

  return (
    <VStack align="stretch" gap={6}>
      <HStack align="stretch" gap={4} flexWrap="wrap">
        <CostLanePanel
          testId="cost-lane-billed"
          label="Billed by provider"
          description="What your providers report they will invoice."
          amountUsd={data.billed.amountUsd}
          cellsWithoutAmount={data.billed.cellsWithoutAmount}
        />
        <CostLanePanel
          testId="cost-lane-gateway"
          label="Metered by gateway"
          description="What the gateway measured as it served your traffic."
          amountUsd={data.gateway.amountUsd}
          cellsWithoutAmount={data.gateway.cellsWithoutAmount}
        />
        <SeatLanePanel testId="cost-lane-seats" seats={data.seats} />
      </HStack>
      <CostLanesChart series={data.series} />
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
  overTime: DailyBucket[] | null;
  modelOverTime: DailyBucket[] | null;
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

function useBreakdownQueries({
  organizationId,
  windowDays,
  groupBy,
  enabled,
}: {
  organizationId: string;
  windowDays: number;
  groupBy: GroupBy;
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
    { ...args, groupBy },
    options,
  );
  const byModel = api.activityMonitor.spendOverTime.useQuery(
    { ...args, groupBy: "model" as const },
    options,
  );

  const departmentRows = byDepartment.data ?? null;
  return {
    departmentRows,
    // The picker is the one place an unanswered read may fall back to empty:
    // it offers choices, it does not report a measurement.
    departments: (departmentRows ?? []).map((row) => ({
      id: row.departmentId ?? "unassigned",
      name: row.departmentName,
    })),
    userRows: byUser.data ?? null,
    activeUsers: summary.data?.activeUsersThisWindow ?? null,
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

function CostBreakdowns({
  filters,
  breakdowns,
  showSample,
}: {
  filters: CostFilters;
  breakdowns: Breakdowns;
  showSample: boolean;
}) {
  const days = useMemo(
    () => recentDays(filters.windowDays),
    [filters.windowDays],
  );
  const sample = useSampleSeries(days, filters.interval);

  // Null in, null out — an unanswered read stays unanswered all the way to the
  // panel rather than turning into an empty list that reads as a measurement.
  const departmentRows =
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
          }));
  const userRows =
    breakdowns.userRows === null
      ? null
      : breakdowns.userRows.map((row) => ({
          key: row.actor,
          label: row.actor,
          value: Number(row.spendUsd),
        }));

  return (
    <VStack align="stretch" gap={4}>
      <AdoptionRow breakdowns={breakdowns} />
      {showSample && (
        <SimpleGrid columns={{ base: 1, lg: 2 }} gap={4}>
          <CostPanel title="Consumption forecast · by agent" sample>
            <CostForecastArea
              buckets={sample.forecast.buckets}
              projectedFromDay={sample.forecast.projectedFromDay}
            />
          </CostPanel>
          <CostPanel title="Subscriptions · by department" sample>
            <CostStackedBars buckets={sample.subscriptions} />
          </CostPanel>
        </SimpleGrid>
      )}

      {/* One grid, in the prototype's order. With samples off the four
          measured panels close ranks and the grid reflows around them. */}
      <SimpleGrid columns={{ base: 1, xl: 3 }} gap={4}>
        {/* The placeholder series is agents whatever Group By says, so this
            title does not follow it — a chart labelled by model showing agent
            names would be worse than a fixed label. */}
        {showSample && (
          <CostPanel title="% cost by agent" sample>
            <CostDonut rows={sample.agents} />
          </CostPanel>
        )}
        <CostPanel title={`Cost evolution by ${filters.groupBy}`}>
          <CostStackedBars
            buckets={
              breakdowns.overTime === null
                ? null
                : aggregateBuckets(breakdowns.overTime, filters.interval)
            }
          />
        </CostPanel>
        <CostPanel title="Cost by department">
          <CostRankList rows={departmentRows} />
        </CostPanel>

        {showSample && (
          <CostPanel title="Cost by agent" sample>
            <CostRankList rows={sample.agents} />
          </CostPanel>
        )}
        <CostPanel title="Cost by model">
          <CostRankList
            rows={
              breakdowns.modelOverTime === null
                ? null
                : totalPerSeries(breakdowns.modelOverTime)
            }
          />
        </CostPanel>
        <CostPanel title="Cost by user">
          <CostRankList rows={userRows} />
        </CostPanel>

        {showSample && (
          <>
            <CostPanel title="Genie questions over time" sample>
              <CostStackedBars
                buckets={sample.genie}
                format={fmtCount}
                showLegend={false}
              />
            </CostPanel>
            <CostPanel title="Tokens over time" sample>
              <CostLine points={sample.tokens} />
            </CostPanel>
            <CostPanel title="Subscriptions vs consumption" sample>
              <CostStackedBars
                buckets={sample.seatsVsUsage}
                showLegend={false}
              />
            </CostPanel>
          </>
        )}
      </SimpleGrid>
    </VStack>
  );
}

/**
 * Active users for the window, and only that.
 *
 * An interaction count used to sit beside it, summed from the ranked user
 * rows — but that read is a top-8, so the sum was the leaders' share wearing
 * the name of an organization-wide total. There is no whole-window
 * interaction count to put there instead, so the figure is gone rather than
 * quietly wrong.
 */
function AdoptionRow({ breakdowns }: { breakdowns: Breakdowns }) {
  return (
    <CostPanel title="Adoption">
      {breakdowns.activeUsers === null ? (
        <Text fontSize="sm" color="fg.muted">
          Not available.
        </Text>
      ) : (
        <HStack gap={10} align="flex-end">
          <Stat
            label="Users"
            value={numeral(breakdowns.activeUsers).format("0,0")}
          />
        </HStack>
      )}
    </CostPanel>
  );
}

/** Every placeholder series the page needs, folded to the chosen interval. */
function useSampleSeries(days: string[], interval: TimeInterval) {
  return useMemo(() => {
    const forecast = sampleForecast(days, SAMPLE_AGENTS.slice(0, 5), 2200);
    return {
      agents: sampleRanked(SAMPLE_AGENTS, 2296),
      forecast: {
        buckets: aggregateBuckets(forecast.buckets, interval),
        // The projection marker sits on a specific day, so it only lines up
        // with the axis while the axis is days. Weekly and monthly folds drop
        // it rather than point it at a bucket boundary it does not fall on.
        projectedFromDay: interval === "day" ? forecast.projectedFromDay : null,
      },
      subscriptions: aggregateBuckets(
        sampleDaily(days, SAMPLE_DEPARTMENTS, 3600),
        interval,
      ),
      genie: aggregateBuckets(
        sampleDaily(days, SAMPLE_AGENTS.slice(0, 6), 26),
        interval,
      ),
      tokens: aggregateLine(
        sampleLine(days, "tokens", 3_000_000_000),
        interval,
      ),
      seatsVsUsage: aggregateBuckets(
        sampleDaily(days, ["Usage", "Seat", "Cloud", "Activity"], 2400),
        interval,
      ),
    };
  }, [days, interval]);
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
