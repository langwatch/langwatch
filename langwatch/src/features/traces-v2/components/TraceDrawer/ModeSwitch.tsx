import type { ReactNode } from "react";
import { Flex, HStack, Text } from "@chakra-ui/react";
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
  hasScenario?: boolean;
  /** Trace id used to scope the per-mode peer presence dots. */
  traceId?: string;
}

interface SegmentProps {
  label: string;
  shortcut: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  isLast?: boolean;
  accent?: "blue" | "purple";
  presence?: ReactNode;
}

function ModePresenceDot({
  traceId,
  mode,
}: {
  traceId: string;
  mode: DrawerViewMode;
}) {
  const peers = usePresenceStore((s) =>
    selectPeersMatching(
      s,
      (session) =>
        session.location.route.traceId === traceId &&
        session.location.view?.mode === mode,
    ),
  );
  if (peers.length === 0) return null;
  return <PresenceMarker peers={peers} size={16} tooltipSuffix={`${mode} view`} />;
}

function Segment({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  isLast,
  accent = "blue",
  presence,
}: SegmentProps) {
  const activeBg =
    active && accent === "purple" ? "purple.500/14" : "bg.emphasized";
  return (
    <Flex
      as="button"
      align="center"
      gap={1.5}
      paddingX={2.5}
      height="26px"
      cursor={disabled ? "not-allowed" : "pointer"}
      bg={active ? activeBg : "bg.panel"}
      color={
        active
          ? accent === "purple"
            ? "purple.fg"
            : "fg"
          : disabled
            ? "fg.subtle"
            : "fg.muted"
      }
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
      {presence}
    </Flex>
  );
}

export function ModeSwitch({
  viewMode,
  onViewModeChange,
  turnLabel,
  hasConversation = true,
  hasScenario = false,
  traceId,
}: ModeSwitchProps) {
  const conversationDisabled = !hasConversation;
  const scenarioDisabled = !hasScenario;

  const presenceFor = (mode: DrawerViewMode) =>
    traceId ? <ModePresenceDot traceId={traceId} mode={mode} /> : null;

  const conversationSegment = (
    <Segment
      label="Conversation"
      shortcut="C"
      active={viewMode === "conversation"}
      disabled={conversationDisabled}
      onClick={() => onViewModeChange("conversation")}
      isLast={!hasScenario}
      presence={presenceFor("conversation")}
    />
  );

  const scenarioSegment = (
    <Segment
      label="Scenario"
      shortcut="S"
      active={viewMode === "scenario"}
      disabled={scenarioDisabled}
      onClick={() => onViewModeChange("scenario")}
      isLast
      accent="purple"
      presence={presenceFor("scenario")}
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
          presence={presenceFor("trace")}
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
        {hasScenario && scenarioSegment}
      </HStack>
      {turnLabel && viewMode === "trace" && (
        <Text textStyle="xs" color="fg.muted">{turnLabel}</Text>
      )}
    </HStack>
  );
}
