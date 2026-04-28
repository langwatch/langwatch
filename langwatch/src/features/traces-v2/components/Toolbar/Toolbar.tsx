import { Button, Flex, Icon } from "@chakra-ui/react";
import { Sparkles } from "lucide-react";
import type React from "react";
import { useWelcomeStore } from "../../stores/welcomeStore";
import { ColumnsDropdown } from "./ColumnsDropdown";
import { DensityToggle } from "./DensityToggle";
import { GroupingSelector } from "./GroupingSelector";
import { KeyboardShortcutsButton } from "./KeyboardShortcutsButton";
import { LensTabs } from "./LensTabs";
import { LiveIndicator } from "./LiveIndicator";
import { TimeRangePicker } from "./TimeRangePicker";

export const Toolbar: React.FC = () => {
  const openWelcome = useWelcomeStore((s) => s.open);

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
        <KeyboardShortcutsButton />
      </Flex>
    </Flex>
  );
};
