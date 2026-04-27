import { Flex, HStack, Text } from "@chakra-ui/react";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import type { DrawerViewMode } from "../../stores/drawerStore";

interface ModeSwitchProps {
  viewMode: DrawerViewMode;
  onViewModeChange: (mode: DrawerViewMode) => void;
  turnLabel?: string;
  hasConversation?: boolean;
}

interface SegmentProps {
  label: string;
  shortcut: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  isLast?: boolean;
}

function Segment({ label, shortcut, active, disabled, onClick, isLast }: SegmentProps) {
  const inner = (
    <Flex
      as="button"
      align="center"
      gap={1.5}
      paddingX={2.5}
      height="26px"
      cursor={disabled ? "not-allowed" : "pointer"}
      bg={active ? "bg.emphasized" : "bg.panel"}
      color={active ? "fg" : disabled ? "fg.subtle" : "fg.muted"}
      fontWeight={active ? "semibold" : "medium"}
      borderRightWidth={isLast ? "0" : "1px"}
      borderColor="border"
      transition="background 0.12s ease, color 0.12s ease"
      _hover={
        active || disabled
          ? undefined
          : { bg: "bg.muted", color: "fg" }
      }
      onClick={disabled ? undefined : onClick}
      opacity={disabled ? 0.6 : 1}
    >
      <Text textStyle="xs">{label}</Text>
      <Kbd>{shortcut}</Kbd>
    </Flex>
  );
  return inner;
}

export function ModeSwitch({
  viewMode,
  onViewModeChange,
  turnLabel,
  hasConversation = true,
}: ModeSwitchProps) {
  const conversationDisabled = !hasConversation;

  const conversationSegment = (
    <Segment
      label="Conversation"
      shortcut="C"
      active={viewMode === "conversation"}
      disabled={conversationDisabled}
      onClick={() => onViewModeChange("conversation")}
      isLast
    />
  );

  return (
    <HStack paddingX={4} paddingY={1} gap={2}>
      <HStack
        gap={0}
        borderRadius="md"
        borderWidth="1px"
        borderColor="border"
        overflow="hidden"
        bg="bg.panel"
      >
        <Segment
          label="Trace"
          shortcut="T"
          active={viewMode === "trace"}
          onClick={() => onViewModeChange("trace")}
        />
        {conversationDisabled ? (
          <Tooltip
            content="This trace is not part of a conversation"
            positioning={{ placement: "bottom" }}
          >
            {conversationSegment}
          </Tooltip>
        ) : (
          conversationSegment
        )}
      </HStack>
      {turnLabel && viewMode === "trace" && (
        <Text textStyle="xs" color="fg.muted">{turnLabel}</Text>
      )}
    </HStack>
  );
}
