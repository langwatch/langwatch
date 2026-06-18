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
  /**
   * True while the conversation context (turns) is still being fetched
   * for a trace that declares a conversationId. In that window the
   * Conversation tab is gated off with a "Loading conversation…"
   * tooltip rather than enabled-but-empty — clicking through to a
   * "no turns found" pane the moment the user opens the drawer reads
   * as broken even though the data is en route.
   */
  isConversationLoading?: boolean;
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
      {/* Tiny spacer wrapping the Kbd — without it the shortcut chip
          ran into the label and read as "SummaryO" instead of the
          intended "Summary [O]". Kbd is a closed component (no style
          override props), so the separation lives on a wrapper box. */}
      <Box marginLeft={0.5}>
        <Kbd>{shortcut}</Kbd>
      </Box>
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
 * Inline tab strip below the header chips. Three modes:
 *   - Trace       — waterfall + (optional) span detail pane
 *   - Summary     — trace-level accordions (I/O, metadata, evals, events)
 *   - Conversation — multi-turn chat rollup, only when the trace carries
 *                    a conversation id
 *
 * Summary used to be a tab inside the SpanTabBar; it moved here during
 * the trace-view redesign so a user reading the trace summary doesn't
 * have to lose their viz pane when they want to scan the metadata.
 */
export function ModeSwitch({
  viewMode,
  onViewModeChange,
  turnLabel,
  hasConversation = true,
  isConversationLoading = false,
  traceId,
  endSlot,
}: ModeSwitchProps) {
  // Tristate gate: no conversationId → permanently disabled; has id
  // but turns still in flight → disabled with loading copy; has id +
  // turns → enabled.
  const conversationDisabled = !hasConversation || isConversationLoading;
  const conversationDisabledReason = !hasConversation
    ? "This trace is not part of a conversation"
    : isConversationLoading
      ? "Loading conversation…"
      : undefined;
  const presenceFor = (mode: DrawerViewMode) =>
    traceId ? <ModePresenceDot traceId={traceId} mode={mode} /> : null;

  return (
    <HStack paddingX={4} gap={4} align="center">
      {/*
        Tab order: Summary | Trace | Conversation. Summary leads because
        it's the friendlier default for non-engineering users who just want
        I/O + metadata at a glance; Trace sits middle for the waterfall +
        span detail workflow; Conversation comes last and gates on
        `hasConversation`. The previous order put Trace first to match the
        store default — surfacing Summary instead lets the
        last-used-mode persistence (see `drawerStore.lastModeChosen`)
        carry observability-first users straight back to where they were.
      */}
      <ModeTab
        label="Summary"
        shortcut="O"
        active={viewMode === "summary"}
        onClick={() => onViewModeChange("summary")}
        presence={presenceFor("summary")}
      />
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
        disabled={conversationDisabled}
        disabledReason={conversationDisabledReason}
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
