import { Button, Flex, Icon } from "@chakra-ui/react";
import { Download, Search, Sparkles } from "lucide-react";
import type React from "react";
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
        <Button
          size="xs"
          variant={findIsOpen ? "subtle" : "ghost"}
          onClick={() => (findIsOpen ? closeFind() : openFind())}
          aria-label="Find in loaded traces"
          aria-pressed={findIsOpen}
        >
          <Icon boxSize={3.5}>
            <Search />
          </Icon>
          Find
        </Button>
        {onExportAll && (
          <Button
            size="xs"
            variant="ghost"
            onClick={onExportAll}
            aria-label="Export traces"
          >
            <Icon boxSize={3.5}>
              <Download />
            </Icon>
            Export
          </Button>
        )}
        <KeyboardShortcutsButton />
      </Flex>
    </Flex>
  );
};
