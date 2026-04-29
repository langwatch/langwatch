import { Box, Flex, HStack, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Tooltip } from "~/components/ui/tooltip";
import { PresenceMarker } from "~/features/presence/components/PresenceMarker";
import {
  selectPeersMatching,
  usePresenceStore,
} from "~/features/presence/stores/presenceStore";
import type { DrawerViewMode } from "../../stores/drawerStore";

interface ModeSwitchProps {
  viewMode: DrawerViewMode;
  onViewModeChange: (mode: DrawerViewMode) => void;
  turnLabel?: string;
  hasConversation?: boolean;
  /** Trace id used to scope the per-mode peer presence dots. */
  traceId?: string;
  /**
   * Right-aligned trailing content for this row — typically the trace ID
   * + relative timestamp. Sits in the same horizontal band as the tabs so
   * the meta tucks neatly into the corner.
   */
  endSlot?: ReactNode;
}

interface TabProps {
  label: string;
  shortcut: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  presence?: ReactNode;
  disabledReason?: string;
}

function ModePresenceDot({
  traceId,
  mode,
}: {
  traceId: string;
  mode: DrawerViewMode;
}) {
  const peers = usePresenceStore(
    useShallow((s) =>
      selectPeersMatching(
        s,
        (session) =>
          session.location.route.traceId === traceId &&
          session.location.view?.mode === mode,
      ),
    ),
  );
  if (peers.length === 0) return null;
  return (
    <PresenceMarker peers={peers} size={16} tooltipSuffix={`${mode} view`} />
  );
}

function ModeTab({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  presence,
  disabledReason,
}: TabProps) {
  const tab = (
    <Flex
      as={disabled ? "div" : "button"}
      align="center"
      gap={1}
      paddingX={0.5}
      paddingY={2}
      cursor={disabled ? "not-allowed" : "pointer"}
      color={active ? "fg" : disabled ? "fg.subtle" : "fg.muted"}
      fontWeight={active ? "semibold" : "medium"}
      transition="color 0.12s ease"
      _hover={active || disabled ? undefined : { color: "fg" }}
      onClick={disabled ? undefined : onClick}
      position="relative"
      opacity={disabled ? 0.5 : 1}
    >
      <Text textStyle="sm">{label}</Text>
      <Kbd>{shortcut}</Kbd>
      {presence}
      {/* Active indicator — a 2px underline that aligns with the row's
          bottom border. Only the active tab paints it. */}
      <Box
        position="absolute"
        left={0}
        right={0}
        bottom="-1px"
        height="2px"
        bg={active ? "blue.solid" : "transparent"}
        borderTopRadius="full"
        transition="background 0.12s ease"
      />
    </Flex>
  );

  if (disabled && disabledReason) {
    return (
      <Tooltip content={disabledReason} positioning={{ placement: "bottom" }}>
        {tab}
      </Tooltip>
    );
  }

  return tab;
}

/**
 * Inline tab strip below the header chips. Toggles between the trace view
 * and the conversation rollup. Scenario lives as a chip link-out in the
 * header, not as a third tab here — keeping this row to two options keeps
 * the visual weight low.
 */
export function ModeSwitch({
  viewMode,
  onViewModeChange,
  turnLabel,
  hasConversation = true,
  traceId,
  endSlot,
}: ModeSwitchProps) {
  const presenceFor = (mode: DrawerViewMode) =>
    traceId ? <ModePresenceDot traceId={traceId} mode={mode} /> : null;

  return (
    <HStack
      paddingX={4}
      gap={4}
      align="center"
    >
      <ModeTab
        label="Trace"
        shortcut="T"
        active={viewMode === "trace"}
        onClick={() => onViewModeChange("trace")}
        presence={presenceFor("trace")}
      />
      <ModeTab
        label="Conversation"
        shortcut="C"
        active={viewMode === "conversation"}
        disabled={!hasConversation}
        disabledReason={
          hasConversation
            ? undefined
            : "This trace is not part of a conversation"
        }
        onClick={() => onViewModeChange("conversation")}
        presence={presenceFor("conversation")}
      />
      {turnLabel && viewMode === "trace" && (
        <Text textStyle="xs" color="fg.muted" marginLeft="auto">
          {turnLabel}
        </Text>
      )}
      {endSlot && (
        <HStack
          marginLeft={turnLabel && viewMode === "trace" ? undefined : "auto"}
          flexShrink={0}
        >
          {endSlot}
        </HStack>
      )}
    </HStack>
  );
}
