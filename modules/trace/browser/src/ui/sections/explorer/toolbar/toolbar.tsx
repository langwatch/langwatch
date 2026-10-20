import { Box, Button, Flex, HStack, Icon, IconButton } from "@langwatch/design-system/primitives";
import { shortcutAriaKeys } from "@langwatch/design-system/shortcut-hint";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { Bookmark, Compass, Download, Map, PanelLeftOpen, Tent } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";

import { useFilterStore, useViewStore } from "../../../../behavior/explorer.store.ts";
import { useOnboardingStore } from "../../../../behavior/explorer/onboarding/store/onboarding-store.ts";
import { useProjectHasTraces } from "../../../../behavior/explorer/use-project-has-traces.ts";
import { useDismissTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { useUIStore } from "../../../../behavior/ui.store.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../../../../model/explorer/onboarding/spotlights/spotlights.ts";
import { LensNamePopover } from "../../../elements/explorer/toolbar/lens-name-popover.tsx";
import { useIsNewAccount } from "../hooks/use-is-new-account.ts";
import { useTraceExplorerTourPreference } from "../onboarding/hooks/use-trace-explorer-tour-preference.ts";
import { useTourEntryPoints } from "../onboarding/index.ts";
import { writeSpotlightFragment } from "../onboarding/spotlights/spotlight-overlay.tsx";
import { PAGE_SHORTCUTS } from "../traces-page/page-keyboard-shortcuts.tsx";
import { ColumnsDropdown } from "./columns-dropdown.tsx";
import { DensitySelect } from "./density-select.tsx";
import { GroupingSelect } from "./grouping-select.tsx";
import { LensTabs } from "./lens-tabs.tsx";
import { LiveIndicator } from "./live-indicator.tsx";
import { TimeRangePicker } from "./time-range-picker.tsx";
import { AutomateButton, KeyboardShortcutsButton } from "./toolbar-actions.tsx";

// Toolbar widths (the bar's own measured width, not the viewport) at which each level of
// the right clusters still leaves LENS_STRIP_ROOM for the lens tabs (All to Cost in the
// default set): the clusters' measured width at that level plus the lens room. Lens tabs
// matter more than labels, so labels go first, then chevrons; only then do lenses overflow.
const LENS_STRIP_ROOM = 560;
const TOOLBAR_WIDE_MIN_WIDTH = 900 + LENS_STRIP_ROOM;
const TOOLBAR_LABELS_MIN_WIDTH = 850 + LENS_STRIP_ROOM;
const TOOLBAR_CHEVRONS_MIN_WIDTH = 580 + LENS_STRIP_ROOM;
// Extra room the optional controls take while they show their labels.
const SAMPLE_TOGGLE_WIDTH = 120;
const TOUR_LABEL_WIDTH = 100;

export function toolbarCompactness({
  width,
  hasSampleToggle,
  hasTourLabel,
}: {
  width: number;
  hasSampleToggle: boolean;
  hasTourLabel: boolean;
}): { wide: boolean; labelsCompact: boolean; chevronsCompact: boolean } {
  if (width <= 0) return { wide: false, labelsCompact: false, chevronsCompact: false };
  const optional =
    (hasSampleToggle ? SAMPLE_TOGGLE_WIDTH : 0) + (hasTourLabel ? TOUR_LABEL_WIDTH : 0);
  return {
    wide: width >= TOOLBAR_WIDE_MIN_WIDTH + optional,
    labelsCompact: width < TOOLBAR_LABELS_MIN_WIDTH + optional,
    chevronsCompact: width < TOOLBAR_CHEVRONS_MIN_WIDTH,
  };
}

interface ToolbarProps {
  onExportAll?: () => void;
  /**
   * When true, the "See sample data" toggle is rendered fully transparent (kept in the
   * layout so the toolbar spacing doesn't jump but invisible to the user).
   */
  hideSampleDataAction?: boolean;
}

function TourButton({
  showLabel,
  spotlightsActive,
  onClick,
}: {
  showLabel: boolean;
  spotlightsActive: boolean;
  onClick: () => void;
}) {
  if (!showLabel && !spotlightsActive) {
    return (
      <IconButton size="xs" variant="ghost" onClick={onClick} aria-label="Show me around">
        <Icon boxSize={3.5} color={{ base: "fg.muted", _dark: "fg.subtle" }}>
          <Map />
        </Icon>
      </IconButton>
    );
  }

  return (
    <Button
      size="xs"
      variant={spotlightsActive ? "subtle" : "ghost"}
      colorPalette={spotlightsActive ? "blue" : undefined}
      onClick={onClick}
      aria-label={spotlightsActive ? "End tour" : "Show me around"}
      aria-pressed={spotlightsActive}
    >
      <Icon
        boxSize={3.5}
        color={spotlightsActive ? "blue.fg" : { base: "fg.muted", _dark: "fg.subtle" }}
      >
        <Map />
      </Icon>
      {spotlightsActive ? "End tour" : "Show me around"}
    </Button>
  );
}

export const Toolbar: React.FC<ToolbarProps> = ({ onExportAll, hideSampleDataAction = false }) => {
  // Tour entry point — kept for backwards compatibility. The journey
  // state machine (Phase 2) may still use onLaunchTour / onEndTour
  // internally. For Phase 1 the toolbar button exclusively toggles
  // `showSamplePreview` and does NOT launch the journey.
  const { onEndTour } = useTourEntryPoints();

  const showSamplePreview = useOnboardingStore((s) => s.showSamplePreview);
  const setShowSamplePreview = useOnboardingStore((s) => s.setShowSamplePreview);
  // Sample data is an onboarding affordance — once the project has its own real traces
  // (`Project.firstMessage = true`, set by the projectMetadata subscriber on first
  // non-sample ingest), the toggle is noise.
  const { hasAnyTraces } = useProjectHasTraces();
  const isNewAccount = useIsNewAccount();
  const { dismiss: persistTourDismissal } = useTraceExplorerTourPreference();
  const showSampleDataToggle = hasAnyTraces === false;
  const spotlightsActive = useOnboardingStore((s) => s.spotlightsActive);
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore((s) => s.setCurrentSpotlightId);

  const closeDrawer = useDismissTraceDrawer();
  const handleSamplePreviewToggle = () => {
    if (showSamplePreview) {
      setShowSamplePreview(false);
      // Sample data + spotlights ride together — switching samples off
      // dismisses any spotlight tour that was running over them so the
      // page returns to a clean state in one click.
      if (spotlightsActive) persistTourDismissal();
      setSpotlightsActive(false);
      setCurrentSpotlightId(null);
      writeSpotlightFragment(null);
      // A drawer left open over a sample trace would now point at a row
      // that no longer exists in the table — close it with the samples.
      closeDrawer();
      // If the legacy journey was somehow also active, end it cleanly.
      onEndTour();
    } else {
      setShowSamplePreview(true);
      // Auto-start spotlights on sample data: "See sample data" is meant as a tour, which pairs
      // naturally with contextual callouts explaining each surface.
      const first = TRACE_EXPLORER_SPOTLIGHTS[0];
      const firstId = first?.id ?? null;
      setCurrentSpotlightId(firstId);
      setSpotlightsActive(true);
      writeSpotlightFragment(firstId);
    }
  };

  const handleShowMeAround = () => {
    if (spotlightsActive) {
      // Toggle off — dismiss the spotlight tour.
      persistTourDismissal();
      setSpotlightsActive(false);
      setCurrentSpotlightId(null);
      writeSpotlightFragment(null);
    } else {
      // Start the tour from the first spotlight.
      const first = TRACE_EXPLORER_SPOTLIGHTS[0];
      const firstId = first?.id ?? null;
      setCurrentSpotlightId(firstId);
      setSpotlightsActive(true);
      writeSpotlightFragment(firstId);
    }
  };

  // "Save Lens" outline button only surfaces when the active lens has
  // pending local changes. Clicking it opens the shared
  // `LensNamePopover` — same Chakra UI the + new lens button uses.
  // Reverting is one keystroke away via the lens tab's right-click
  // menu and via the draft-dot popover.
  const activeLensId = useViewStore((s) => s.activeLensId);
  const activeLensIsDraft = useViewStore((s) => s.isDraft(activeLensId));
  const activeLensName = useViewStore(
    (s) => s.allLenses.find((l) => l.id === activeLensId)?.name ?? "Current view",
  );
  const createLens = useViewStore((s) => s.createLens);
  // Hide "Save the result as a lens" when the current query has a parse
  // error — saving a broken query as a lens would just create a lens
  // that silently fails to filter on load. The button comes back the
  // moment the error is resolved.
  const hasParseError = useFilterStore((s) => Boolean(s.parseError));
  const { project } = useOrganizationTeamProject();
  const canSaveLenses = !isAggregateProjectKind(project?.kind);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  // Measure the toolbar's own width so controls can collapse when space runs
  // out (narrow window OR a wide filters sidebar — viewport breakpoints miss
  // the latter). Width 0 = not yet measured → render everything (no
  // first-paint flash of collapsed chrome).
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarWidth, setToolbarWidth] = useState(0);
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setToolbarWidth(entries[0]?.contentRect.width ?? 0);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const { wide, labelsCompact, chevronsCompact } = toolbarCompactness({
    width: toolbarWidth,
    hasSampleToggle: !hideSampleDataAction && showSampleDataToggle,
    hasTourLabel: isNewAccount,
  });

  return (
    <Flex
      ref={toolbarRef}
      align="center"
      gap={2}
      paddingX={2}
      borderBottomWidth="1px"
      borderColor="border"
      flexShrink={0}
      minHeight="36px"
    >
      {/* Sample-data toggle leads the bar as a "what am I looking at?" affordance; it sheds
          its label when the bar is narrow. Fully absent when `hideSampleDataAction` is set. */}
      {!hideSampleDataAction && showSampleDataToggle && (
        <Tooltip
          content={showSamplePreview ? "Hide sample traces" : "See sample traces to explore the UI"}
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="xs"
            variant={showSamplePreview ? "subtle" : "ghost"}
            colorPalette={showSamplePreview ? "orange" : undefined}
            onClick={handleSamplePreviewToggle}
            aria-label={showSamplePreview ? "Hide sample data" : "See sample data"}
            aria-pressed={showSamplePreview}
            flexShrink={0}
          >
            <Icon boxSize={3.5} color={{ base: "orange.fg", _dark: "orange.fg" }}>
              {showSamplePreview ? <Tent /> : <Compass />}
            </Icon>
            {!labelsCompact && (showSamplePreview ? "Hide sample data" : "See sample data")}
          </Button>
        </Tooltip>
      )}
      {/* Cluster 1: the Filters button (only while the sidebar is closed) leads the lenses at
          a fixed spot before "All"; the lenses take every pixel the other clusters leave. */}
      {sidebarCollapsed && (
        <Tooltip
          content="Show filters sidebar"
          shortcut={PAGE_SHORTCUTS.sidebar}
          positioning={{ placement: "bottom" }}
        >
          <Button
            aria-label="Show filters sidebar"
            aria-keyshortcuts={shortcutAriaKeys(PAGE_SHORTCUTS.sidebar)}
            variant="outline"
            size="xs"
            fontWeight="medium"
            gap={1.5}
            color="fg.subtle"
            onClick={toggleSidebar}
            flexShrink={0}
          >
            <PanelLeftOpen size={14} />
            Filters
          </Button>
        </Tooltip>
      )}
      <LensTabs />
      {/* Cluster 2: what the table holds and how its rows read: saving the view, the time
          window, freshness, grouping and density. */}
      <HStack gap={1} flexShrink={0}>
        {canSaveLenses && activeLensIsDraft && !hasParseError && (
          <LensNamePopover
            defaultName={`${activeLensName} (copy)`}
            onSubmit={(name) => createLens(name)}
          >
            {/* Icon-only at rest; the label slides out leftwards on hover. Gap 0 so the
                collapsed label leaves no phantom space beside the icon. */}
            <Button
              size="xs"
              variant="outline"
              colorPalette="orange"
              aria-label="Save current filtered view as a new lens"
              className="group"
              gap={0}
            >
              <Box
                as="span"
                maxWidth={0}
                marginRight={0}
                opacity={0}
                overflow="hidden"
                whiteSpace="nowrap"
                transition="max-width 0.25s ease, opacity 0.2s ease, margin-right 0.25s ease"
                _groupHover={{
                  maxWidth: "170px",
                  marginRight: 1.5,
                  opacity: 1,
                }}
                _groupFocusVisible={{
                  maxWidth: "170px",
                  marginRight: 1.5,
                  opacity: 1,
                }}
              >
                Save current filtered view
              </Box>
              <Icon boxSize={3.5}>
                <Bookmark />
              </Icon>
            </Button>
          </LensNamePopover>
        )}
        <TimeRangePicker compact={labelsCompact} />
        <LiveIndicator />
        <GroupingSelect compact={chevronsCompact} />
        <DensitySelect compact={labelsCompact} />
      </HStack>
      <ToolbarDivider />
      {/* Cluster 3: which columns show, getting data out, automating it, and help. */}
      <HStack gap={1} flexShrink={0}>
        <ColumnsDropdown compact={chevronsCompact} showLabel={wide} />
        {onExportAll && (
          <Tooltip
            content="Export the current view to CSV or JSON"
            positioning={{ placement: "bottom" }}
          >
            <IconButton
              size="xs"
              variant="ghost"
              onClick={onExportAll}
              aria-label="Export traces"
              data-testid="trace-toolbar-export"
            >
              <Icon boxSize={3.5}>
                <Download />
              </Icon>
            </IconButton>
          </Tooltip>
        )}
        <AutomateButton compact={labelsCompact} />
        <ToolbarDivider />
        <Tooltip
          content={spotlightsActive ? "End the guided tour" : "Start the guided tour of this page"}
          positioning={{ placement: "bottom" }}
        >
          {/* Full "Show me around" label only for accounts younger than 5 days, and only
              while the bar has room; "End tour" always shows in full so the escape hatch
              stays obvious. */}
          <TourButton
            showLabel={isNewAccount && !labelsCompact}
            spotlightsActive={spotlightsActive}
            onClick={handleShowMeAround}
          />
        </Tooltip>
        <KeyboardShortcutsButton />
      </HStack>
    </Flex>
  );
};

/** Thin vertical hairline between the toolbar's clusters. */
const ToolbarDivider: React.FC = () => (
  <Box width="1px" height="16px" bg="border.muted" flexShrink={0} aria-hidden="true" />
);
