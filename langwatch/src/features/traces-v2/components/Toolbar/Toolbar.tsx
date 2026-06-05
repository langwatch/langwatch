import { Box, Button, Flex, Icon, IconButton } from "@chakra-ui/react";
import { Bookmark, Compass, Download, Tent } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useTourEntryPoints } from "../../onboarding";
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
  // Tour entry point — the toolbar's only onboarding affordance. The
  // What's-new dialog used to live next to this button; it retired
  // when the tour outro absorbed its content (release notes,
  // multiplayer hint, shortcuts, beta note). Replaying the tour
  // takes the user past the OutroPanel, which is now the only
  // surface for that information. While the journey is rendering
  // the same button doubles as the exit ("On safari" → click to
  // end), so users have one consistent place to leave the demo
  // instead of hunting for an exit in the empty-state body.
  const { onLaunchTour, onEndTour, tourActive } = useTourEntryPoints();

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
        {activeLensIsDraft && (
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
              Save Lens
            </Button>
          </LensNamePopover>
        )}
        <Tooltip
          content={
            tourActive
              ? "Click to end the tour"
              : "Take the trace explorer tour"
          }
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="xs"
            variant={tourActive ? "subtle" : "ghost"}
            colorPalette={tourActive ? "orange" : undefined}
            onClick={tourActive ? onEndTour : onLaunchTour}
            aria-label={tourActive ? "End the tour" : "Take the tour"}
            aria-pressed={tourActive}
          >
            {/* Brighter orange in light mode (matches the orange
                indicator dot on the "All" lens tab) — `orange.fg` was
                rendering as muted brown on the white toolbar surface. */}
            <Icon
              boxSize={3.5}
              color={{ base: "orange.500", _dark: "orange.fg" }}
            >
              {tourActive ? <Tent /> : <Compass />}
            </Icon>
            {tourActive ? "On safari" : "Tour"}
          </Button>
        </Tooltip>
        <LiveIndicator />
        {/* Vertical separator clusters the toolbar into:
              [Save · Tour · Live] · [Time] · [Display: cols, group, density]
              · [Tools: find, export, automate] · [Help]
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
