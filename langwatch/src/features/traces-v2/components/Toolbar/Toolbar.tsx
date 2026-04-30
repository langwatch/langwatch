import { Button, Flex, Icon, IconButton } from "@chakra-ui/react";
import { Compass, Download, Search, Sparkles } from "lucide-react";
import type React from "react";
import { Tooltip } from "~/components/ui/tooltip";
import { useTourEntryPoints } from "../../onboarding";
import { useFindStore } from "../../stores/findStore";
import { useWelcomeStore } from "../../stores/welcomeStore";
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
  const openWelcome = useWelcomeStore((s) => s.open);
  const findIsOpen = useFindStore((s) => s.isOpen);
  const openFind = useFindStore((s) => s.open);
  const closeFind = useFindStore((s) => s.close);
  // Tour entry point — this is the toolbar's hook for "let me see the
  // empty-state journey" (existing customers + replay). The hook
  // handles flipping `tourActive` so the journey runs over the real
  // data table, and clears any prior dismissal. The `What's-new`
  // button stays separate for now — it'll be absorbed into the tour's
  // OutroPanel as part of Step 10 of the onboarding migration plan,
  // and only then does its own button retire.
  const { onLaunchTour } = useTourEntryPoints();

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
          content="Take the trace explorer tour"
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="xs"
            variant="ghost"
            onClick={onLaunchTour}
            aria-label="Take the tour"
          >
            <Icon boxSize={3.5} color="orange.fg">
              <Compass />
            </Icon>
            Tour
          </Button>
        </Tooltip>
        <Button
          size="xs"
          variant="ghost"
          onClick={openWelcome}
          aria-label="What's new in traces"
        >
          <Icon boxSize={3.5} color="purple.fg">
            <Sparkles />
          </Icon>
          What&apos;s new
        </Button>
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
        <KeyboardShortcutsButton />
      </Flex>
    </Flex>
  );
};
