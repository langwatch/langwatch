/**
 * The governance Dashboards page: four authored cost widgets on the product's
 * own chart grid.
 *
 * It is a PICTURE OF A DASHBOARD, not a dashboard workspace. The widgets are
 * written in the repository (`components/governance/dashboards/governanceWidgets.ts`)
 * rather than composed by the reader, so the page carries nothing that adds,
 * renames, deletes or saves a widget — there is no row behind any of it to
 * write to. That absence is the page's whole contract, and
 * `__tests__/dashboardsPage.integration.test.tsx` holds it from both sides: by
 * what renders, and by reading this source for anything that could persist.
 *
 * NOTHING HERE READS A ROW EITHER. The four queries ask
 * `governance_cost_rollup_1d`, which is not in the LangWatchQL catalog, so
 * there is no real answer to draw. Rather than four broken charts, the chart
 * frames are handed `createSampleExecuteQuery` — a factory that takes the time
 * frame and nothing else, so there is no identifier a read could even be
 * attempted on. With sample data off each card says what would fill it instead
 * of pretending to have failed.
 *
 * Behind the same three guards as Costs, in the same order: the section flag,
 * then the billed-cost release flag, then `governanceCost:view`. Reading what
 * the organization spends is its own capability, and this page shows the same
 * spend Costs does.
 *
 * Spec: specs/governance/governance-dashboards.feature
 */
import { Heading, HStack, Spacer, VStack } from "@chakra-ui/react";
import { CalendarDays } from "lucide-react";
import { useMemo, useState } from "react";

import { ChartGrid } from "~/components/analytics/reports/ChartGrid";
import { GovernanceWidgetCard } from "~/components/governance/dashboards/GovernanceWidgetCard";
import { GOVERNANCE_WIDGETS } from "~/components/governance/dashboards/governanceWidgets";
import { createSampleExecuteQuery } from "~/components/governance/dashboards/sampleWidgetAnswers";
import {
  DEFAULT_TIME_FRAME,
  FilterChip,
  FilterChipRow,
  frameSpanDays,
  TIME_FRAMES,
  type TimeFrame,
  timeFrameLabel,
} from "~/components/governance/filters";
import GovernanceLayout from "~/components/governance/GovernanceLayout";
import {
  SampleDataBanner,
  SampleDataToggle,
  useSampleMode,
} from "~/components/governance/sample";
import { MenuItem } from "~/components/ui/menu";
import { withFeatureFlagGuard } from "~/components/WithFeatureFlagGuard";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import type { ChartGridPlacement } from "~/server/analytics/chartGrid";

const MS_PER_DAY = 86_400_000;

/** Where each card sits, authored with the widgets and never moved by a reader. */
const PLACEMENTS: readonly ChartGridPlacement[] = GOVERNANCE_WIDGETS.map(
  (widget) => widget.placement,
);

/**
 * The grid is draggable by construction, and this page has nowhere to put a
 * new layout. A drag therefore ends where it started: the placements prop is
 * unchanged, so the next render puts every card back.
 */
const keepLayout = (_placements: ChartGridPlacement[]) => undefined;

/**
 * One time chip, and only one.
 *
 * Costs offers a Time Interval chip beside its frame; these widgets bucket by
 * month whatever is asked of them (`sampleWidgetAnswers.ts`), and a chip that
 * changed nothing would be worse than no chip at all — the section-wide rule in
 * `FilterChip`'s own docblock. Department is absent for the same reason: two of
 * these four charts are split by department, and filtering to one would empty
 * them.
 */
function DashboardsFilterBar({
  frame,
  onFrameChange,
}: {
  frame: TimeFrame;
  onFrameChange: (frame: TimeFrame) => void;
}) {
  return (
    <FilterChipRow>
      <FilterChip
        icon={<CalendarDays size={12} />}
        label="Time Frame"
        value={timeFrameLabel(frame)}
      >
        {TIME_FRAMES.map((option) => (
          <MenuItem
            key={option.value}
            value={option.value}
            onClick={() => onFrameChange(option.value)}
          >
            {option.label}
          </MenuItem>
        ))}
      </FilterChip>
    </FilterChipRow>
  );
}

function DashboardsPage() {
  const {
    active: showSample,
    toggle: toggleSample,
    show: showSampleData,
  } = useSampleMode();
  const [frame, setFrame] = useState<TimeFrame>(DEFAULT_TIME_FRAME);

  // Memoized on the frame, and handed to every card: `GovernanceWidgetCard`
  // builds each chart's dashboard context from it, and a fresh object per
  // render would rebuild four contexts — and re-initialise four frames — on
  // every keystroke elsewhere on the page.
  const timeWindow = useMemo(() => {
    const end = Date.now();
    return { start: end - frameSpanDays({ frame }) * MS_PER_DAY, end };
  }, [frame]);

  // The invented figures follow the frame, so narrowing the window draws a
  // narrower series rather than the same twelve months relabelled.
  const executeQuery = useMemo(
    () => createSampleExecuteQuery({ frame }),
    [frame],
  );

  return (
    <GovernanceLayout pageTitle="Dashboards · AI Governance · LangWatch">
      <VStack align="stretch" gap={5} width="full">
        <HStack align="center" gap={3}>
          <Heading size="md">Dashboards</Heading>
          <Spacer />
          <SampleDataToggle active={showSample} onToggle={toggleSample} />
        </HStack>
        {showSample && (
          <SampleDataBanner>
            Viewing sample data. Nothing here is real — these widgets are drawn
            from invented figures.
          </SampleDataBanner>
        )}
        <DashboardsFilterBar frame={frame} onFrameChange={setFrame} />
        <ChartGrid
          placements={PLACEMENTS}
          onPlacementsCommit={keepLayout}
          renderCard={(placement) => {
            const widget = GOVERNANCE_WIDGETS.find(
              (candidate) => candidate.placement.graphId === placement.graphId,
            );
            if (!widget) return null;
            return (
              <GovernanceWidgetCard
                widget={widget}
                showSample={showSample}
                executeQuery={executeQuery}
                timeWindow={timeWindow}
                onShowSample={showSampleData}
              />
            );
          }}
        />
      </VStack>
    </GovernanceLayout>
  );
}

// Composed on top of the section-wide governance flag, never instead of it,
// and in the same order Costs composes them: this page shows the same spend
// behind the same capability, so it cannot be reachable when Costs is not.
export default withFeatureFlagGuard("release_ui_ai_governance_enabled", {
  bypassOnboardingRedirect: true,
})(
  withFeatureFlagGuard("release_ui_governance_billed_cost_enabled", {
    bypassOnboardingRedirect: true,
  })(
    withPermissionGuard("governanceCost:view", {
      bypassOnboardingRedirect: true,
    })(DashboardsPage),
  ),
);
