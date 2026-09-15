/**
 * The governance Dashboards page: four authored cost widgets on the product's
 * own chart grid.
 *
 * It is a PICTURE OF A DASHBOARD, not a dashboard workspace. The widgets are
 * written in the repository (`components/governance/dashboards/governanceWidgets.ts`)
 * rather than composed by the reader, so the page itself carries nothing that
 * adds, renames, deletes or duplicates a widget — there is no row behind any of
 * it to write to. That absence is the page's whole contract, and
 * `__tests__/dashboardsPage.integration.test.tsx` holds it from both sides: by
 * what renders, and by reading this source for anything that could persist.
 *
 * Each card does open the product's own widget editor, whole, Save included —
 * offering a stripped copy of it would teach a reader that this page is a
 * mock-up of the dashboard feature rather than a picture drawn with it. A Save
 * lands in `widgets` below and nowhere else, so it lasts the visit and the
 * reload takes it away. The reasoning is in `useGovernanceWidgetEditor.ts`.
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
import { useCallback, useMemo, useState } from "react";

import { ChartGrid } from "~/components/analytics/reports/ChartGrid";
import { GovernanceWidgetCard } from "~/components/governance/dashboards/GovernanceWidgetCard";
import type { GovernanceWidget } from "~/components/governance/dashboards/governanceWidgets";
import { GOVERNANCE_WIDGETS } from "~/components/governance/dashboards/governanceWidgets";
import {
  createSampleExecuteQuery,
  refuseWhileSampleIsOff,
} from "~/components/governance/dashboards/sampleWidgetAnswers";
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

/** Where each card sits when the page opens, authored beside the widgets. */
const AUTHORED_PLACEMENTS: readonly ChartGridPlacement[] =
  GOVERNANCE_WIDGETS.map((widget) => widget.placement);

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
  const { active: showSample, toggle: toggleSample } = useSampleMode();
  const [frame, setFrame] = useState<TimeFrame>(DEFAULT_TIME_FRAME);

  // The four widgets as they stand RIGHT NOW, which is the authored four until
  // somebody saves an edit in a widget's editor. Held here and nowhere else:
  // there is no row behind any of them, so the reload is what takes an edit
  // away, and that is the honest behaviour rather than a missing feature. See
  // `useGovernanceWidgetEditor.ts`.
  const [widgets, setWidgets] =
    useState<readonly GovernanceWidget[]>(GOVERNANCE_WIDGETS);

  const saveWidget = useCallback((edited: GovernanceWidget) => {
    setWidgets((current) =>
      current.map((widget) => (widget.id === edited.id ? edited : widget)),
    );
  }, []);

  // The grid is draggable by construction, so a card the reader drags has to
  // stay where it was dropped — a card that springs back reads as a bug, not
  // as a locked layout. It stays for the visit and no longer: there is no row
  // behind this page to save a layout to, and the page may not grow one (see
  // the docblock above), so the next visit opens on the authored arrangement.
  const [placements, setPlacements] = useState<ChartGridPlacement[]>(() =>
    AUTHORED_PLACEMENTS.map((placement) => ({ ...placement })),
  );

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
  //
  // And they are only handed out at all once the reader has ASKED for them.
  // The cards already draw nothing with sample off, but the editor behind a
  // card has its own chart and its own Run, and neither is on the card's
  // branch — so the rule is kept here, at the one source of every figure on
  // this page, rather than at each of the three places one could be drawn.
  const executeQuery = useMemo(
    () =>
      showSample ? createSampleExecuteQuery({ frame }) : refuseWhileSampleIsOff,
    [frame, showSample],
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
          placements={placements}
          onPlacementsCommit={setPlacements}
          renderCard={(placement) => {
            const widget = widgets.find(
              (candidate) => candidate.placement.graphId === placement.graphId,
            );
            if (!widget) return null;
            return (
              <GovernanceWidgetCard
                widget={widget}
                showSample={showSample}
                executeQuery={executeQuery}
                timeWindow={timeWindow}
                onSave={saveWidget}
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
