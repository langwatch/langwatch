import { Box, Button, Flex, Icon, IconButton } from "@chakra-ui/react";
import { Bookmark, Compass, Download, Map, Tent } from "lucide-react";
import type React from "react";
import { useCallback } from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useTourEntryPoints } from "../../onboarding";
import { useOnboardingStore } from "../../onboarding/store/onboardingStore";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../../onboarding/spotlights/spotlights";
import { writeSpotlightFragment } from "../../onboarding/spotlights/SpotlightOverlay";
import { useFilterStore } from "../../stores/filterStore";
import { useViewStore } from "../../stores/viewStore";
import { AutomateButton } from "./AutomateButton";
import { ColumnsDropdown } from "./ColumnsDropdown";
import { DensityToggle } from "./DensityToggle";
import { GroupingSelector } from "./GroupingSelector";
import { KeyboardShortcutsButton } from "./KeyboardShortcutsButton";
import { LensNamePopover } from "./LensNamePopover";
import { LensTabs } from "./LensTabs";
import { LiveIndicator } from "./LiveIndicator";
import { TimeRangePicker } from "./TimeRangePicker";

interface ToolbarProps {
  onExportAll?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onExportAll }) => {
  // Tour entry point — kept for backwards compatibility. The journey
  // state machine (Phase 2) may still use onLaunchTour / onEndTour
  // internally. For Phase 1 the toolbar button exclusively toggles
  // `showSamplePreview` and does NOT launch the journey.
  const { onEndTour } = useTourEntryPoints();

  const showSamplePreview = useOnboardingStore((s) => s.showSamplePreview);
  const setShowSamplePreview = useOnboardingStore(
    (s) => s.setShowSamplePreview,
  );
  const spotlightsActive = useOnboardingStore((s) => s.spotlightsActive);
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore(
    (s) => s.setCurrentSpotlightId,
  );

  const handleSamplePreviewToggle = useCallback(() => {
    if (showSamplePreview) {
      setShowSamplePreview(false);
      // If the legacy journey was somehow also active, end it cleanly.
      onEndTour();
    } else {
      setShowSamplePreview(true);
    }
  }, [showSamplePreview, setShowSamplePreview, onEndTour]);

  const handleShowMeAround = useCallback(() => {
    if (spotlightsActive) {
      // Toggle off — dismiss the spotlight tour.
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
  }, [spotlightsActive, setSpotlightsActive, setCurrentSpotlightId]);

  // "Save Lens" outline button only surfaces when the active lens has
  // pending local changes. Clicking it opens the shared
  // `LensNamePopover` — same Chakra UI the + new lens button uses.
  // Reverting is one keystroke away via the lens tab's right-click
  // menu and via the draft-dot popover.
  const activeLensId = useViewStore((s) => s.activeLensId);
  const activeLensIsDraft = useViewStore((s) => s.isDraft(activeLensId));
  const activeLensName = useViewStore(
    (s) =>
      s.allLenses.find((l) => l.id === activeLensId)?.name ?? "Current view",
  );
  const createLens = useViewStore((s) => s.createLens);
  // Hide "Save the result as a lens" when the current query has a parse
  // error — saving a broken query as a lens would just create a lens
  // that silently fails to filter on load. The button comes back the
  // moment the error is resolved.
  const hasParseError = useFilterStore((s) => Boolean(s.parseError));

  return (
    <Flex
      align="center"
      gap={1.5}
      paddingX={2}
      borderBottomWidth="1px"
      borderColor="border"
      flexShrink={0}
      minHeight="36px"
    >
      <LensTabs />
      <Flex marginLeft="auto" gap={1.5} align="center" flexShrink={0}>
        {activeLensIsDraft && !hasParseError && (
          <LensNamePopover
            defaultName={`${activeLensName} (copy)`}
            onSubmit={(name) => createLens(name)}
          >
            <Button
              size="xs"
              variant="outline"
              colorPalette="orange"
              aria-label="Save current view as a new lens"
            >
              <Icon boxSize={3.5}>
                <Bookmark />
              </Icon>
              Save the result as a lens
            </Button>
          </LensNamePopover>
        )}
        <Tooltip
          content={
            showSamplePreview
              ? "Hide sample traces"
              : "See sample traces to explore the UI"
          }
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="xs"
            variant={showSamplePreview ? "subtle" : "ghost"}
            colorPalette={showSamplePreview ? "orange" : undefined}
            onClick={handleSamplePreviewToggle}
            aria-label={
              showSamplePreview ? "Hide sample data" : "See sample data"
            }
            aria-pressed={showSamplePreview}
          >
            {/* Brighter orange in light mode (matches the orange
                indicator dot on the "All" lens tab) — `orange.fg` was
                rendering as muted brown on the white toolbar surface. */}
            <Icon
              boxSize={3.5}
              color={{ base: "orange.500", _dark: "orange.fg" }}
            >
              {showSamplePreview ? <Tent /> : <Compass />}
            </Icon>
            {showSamplePreview ? "Hide sample data" : "See sample data"}
          </Button>
        </Tooltip>
        <Tooltip
          content={
            spotlightsActive
              ? "End the guided tour"
              : "Start the guided tour of this page"
          }
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="xs"
            variant={spotlightsActive ? "subtle" : "ghost"}
            colorPalette={spotlightsActive ? "blue" : undefined}
            onClick={handleShowMeAround}
            aria-label={spotlightsActive ? "End tour" : "Show me around"}
            aria-pressed={spotlightsActive}
          >
            <Icon
              boxSize={3.5}
              color={
                spotlightsActive
                  ? "blue.fg"
                  : { base: "fg.muted", _dark: "fg.subtle" }
              }
            >
              <Map />
            </Icon>
            {spotlightsActive ? "End tour" : "Show me around"}
          </Button>
        </Tooltip>
        <LiveIndicator />
        {/* Vertical separator clusters the toolbar into:
              [Save · Tour · Live] · [Time] · [Display: cols, group, density]
              · [Tools: export, automate] · [Help]
            Previously these were a flat row of 10 controls with no
            visual hierarchy — auditor pain was "I don't know what
            each icon does, and they all blur together". */}
        <ToolbarDivider />
        <TimeRangePicker />
        <ToolbarDivider />
        <ColumnsDropdown />
        <GroupingSelector />
        <DensityToggle />
        {/* Toolbar Find button retired in Round 3 — Find is bound to
            ⌘/Ctrl+F, exactly where users expect it. The discoverability
            hint moved underneath the search bar so first-time users
            still learn the shortcut without a permanent toolbar icon
            taking up scarce horizontal room. */}
        <ToolbarDivider />
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
            >
              <Icon boxSize={3.5}>
                <Download />
              </Icon>
            </IconButton>
          </Tooltip>
        )}
        <AutomateButton />
        <ToolbarDivider />
        <KeyboardShortcutsButton />
      </Flex>
    </Flex>
  );
};

/** Thin vertical hairline used to cluster the toolbar into role-based
 *  groups (time / display / tools / help). Kept as a tiny presentational
 *  component to avoid repeating the same height + colour + margin
 *  inline four times. */
const ToolbarDivider: React.FC = () => (
  <Box
    width="1px"
    height="14px"
    bg="border.muted"
    marginX={0.5}
    aria-hidden="true"
  />
);
