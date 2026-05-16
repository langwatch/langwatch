import { Button, Flex, Icon, IconButton } from "@chakra-ui/react";
import { Bookmark, Compass, Download, Search, Tent } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useTourEntryPoints } from "../../onboarding";
import { useFindStore } from "../../stores/findStore";
import { useViewStore } from "../../stores/viewStore";
import { AutomateButton } from "./AutomateButton";
import { ColumnsDropdown } from "./ColumnsDropdown";
import { DensityToggle } from "./DensityToggle";
import { GroupingSelector } from "./GroupingSelector";
import { KeyboardShortcutsButton } from "./KeyboardShortcutsButton";
import { LensTabs } from "./LensTabs";
import { LiveIndicator } from "./LiveIndicator";
import { TimeRangePicker } from "./TimeRangePicker";

interface ToolbarProps {
  onExportAll?: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onExportAll }) => {
  const findIsOpen = useFindStore((s) => s.isOpen);
  const openFind = useFindStore((s) => s.open);
  const closeFind = useFindStore((s) => s.close);
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
  // pending local changes. Clicking it opens the same save-as-new flow
  // the lens tab's overflow menu uses (browser prompt for the new
  // name). Reverting is one keystroke away via the lens tab's right-
  // click menu — we don't double up the affordance in the toolbar.
  const activeLensId = useViewStore((s) => s.activeLensId);
  const activeLensIsDraft = useViewStore((s) => s.isDraft(activeLensId));
  const activeLensName = useViewStore(
    (s) =>
      s.allLenses.find((l) => l.id === activeLensId)?.name ?? "Current view",
  );
  const createLens = useViewStore((s) => s.createLens);

  const handleSaveLens = () => {
    if (typeof window === "undefined") return;
    const name = window.prompt(
      "Save current view as a new lens — name:",
      `${activeLensName} (copy)`,
    );
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    createLens(trimmed);
  };

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
        <Tooltip
          content={tourActive ? "Click to end the tour" : "Take the trace explorer tour"}
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
        {activeLensIsDraft && (
          <Tooltip
            content={
              <Flex direction="column" gap={1} maxWidth="240px">
                <span>
                  You've changed the current view's filters, columns, or
                  grouping. Click to save these as a new lens you can
                  always come back to.
                </span>
                <span style={{ opacity: 0.7 }}>
                  Right-click the lens tab → Revert local changes to
                  discard.
                </span>
              </Flex>
            }
            positioning={{ placement: "bottom" }}
          >
            <Button
              size="xs"
              variant="outline"
              colorPalette="orange"
              onClick={handleSaveLens}
              aria-label="Save current view as a new lens"
            >
              <Icon boxSize={3.5}>
                <Bookmark />
              </Icon>
              Save lens
            </Button>
          </Tooltip>
        )}
        <LiveIndicator />
        <TimeRangePicker />
        <ColumnsDropdown />
        <GroupingSelector />
        <DensityToggle />
        <Tooltip
          content="Search within currently loaded traces"
          positioning={{ placement: "bottom" }}
        >
          <IconButton
            size="xs"
            variant={findIsOpen ? "subtle" : "ghost"}
            onClick={() => (findIsOpen ? closeFind() : openFind())}
            aria-label="Find in loaded traces"
            aria-pressed={findIsOpen}
          >
            <Icon boxSize={3.5}>
              <Search />
            </Icon>
          </IconButton>
        </Tooltip>
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
        <KeyboardShortcutsButton />
      </Flex>
    </Flex>
  );
};
