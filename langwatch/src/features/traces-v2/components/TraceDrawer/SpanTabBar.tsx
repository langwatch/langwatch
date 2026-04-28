import {
  Badge,
  Button,
  Circle,
  Flex,
  HStack,
  Icon,
  Text,
} from "@chakra-ui/react";
import { memo } from "react";
import { LuChevronDown, LuFileText, LuPin, LuPinOff, LuX } from "react-icons/lu";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { PresenceMarker } from "~/features/presence/components/PresenceMarker";
import {
  selectPeersMatching,
  usePresenceStore,
} from "~/features/presence/stores/presenceStore";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { usePrefetchSpanDetail } from "../../hooks/usePrefetchSpanDetail";
import type { DrawerTab } from "../../stores/drawerStore";
import {
  abbreviateModel,
  formatDuration,
  SPAN_TYPE_COLORS,
} from "../../utils/formatters";

/**
 * When more than this many spans are pinned, collapse the tail into a
 * "+N more" dropdown so the tab strip doesn't run away into a horizontal
 * scrollbar swamp. We always keep the first three inline so the user has a
 * stable anchor on the left, then the menu picks up the rest.
 */
const MAX_INLINE_PINNED = 4;
const INLINE_KEEP_WHEN_OVERFLOW = 3;

/** Map span type → Chakra colorPalette so Badge variants stay consistent. */
const SPAN_TYPE_PALETTE: Record<string, string> = {
  llm: "blue",
  tool: "green",
  agent: "purple",
  rag: "orange",
  guardrail: "yellow",
  evaluation: "teal",
  chain: "gray",
  span: "gray",
  module: "gray",
};

interface SpanTabBarProps {
  activeTab: DrawerTab;
  onTabChange: (tab: DrawerTab) => void;
  selectedSpan: SpanTreeNode | null;
  onCloseSpanTab: () => void;
  pinnedSpans: SpanTreeNode[];
  onSelectSpan: (spanId: string) => void;
  onPinSpan: (spanId: string) => void;
  onUnpinSpan: (spanId: string) => void;
  traceId?: string;
  /** Distinct prompt references on this trace — drives the Prompts tab. */
  promptCount?: number;
}

function DrawerTabPresenceDot({
  traceId,
  tab,
}: {
  traceId: string;
  tab: DrawerTab;
}) {
  const peers = usePresenceStore((s) =>
    selectPeersMatching(
      s,
      (session) =>
        session.location.route.traceId === traceId &&
        session.location.view?.tab === tab,
    ),
  );
  if (peers.length === 0) return null;
  return (
    <PresenceMarker peers={peers} size={16} tooltipSuffix={`${tab} tab`} />
  );
}

function SpanFocusPresenceDot({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}) {
  const peers = usePresenceStore((s) =>
    selectPeersMatching(
      s,
      (session) =>
        session.location.route.traceId === traceId &&
        session.location.route.spanId === spanId,
    ),
  );
  if (peers.length === 0) return null;
  return <PresenceMarker peers={peers} size={16} tooltipSuffix="this span" />;
}

export const SpanTabBar = memo(function SpanTabBar({
  activeTab,
  onTabChange,
  selectedSpan,
  onCloseSpanTab,
  pinnedSpans,
  onSelectSpan,
  onPinSpan,
  onUnpinSpan,
  traceId,
  promptCount = 0,
}: SpanTabBarProps) {
  const isSelectedPinned = selectedSpan
    ? pinnedSpans.some((s) => s.spanId === selectedSpan.spanId)
    : false;
  const prefetchSpan = usePrefetchSpanDetail();

  return (
    <HStack
      gap="5px"
      paddingX={4}
      borderBottomWidth="1px"
      borderColor="border"
      overflowX="auto"
      flexShrink={0}
      align="stretch"
      minHeight="38px"
      css={{ "&::-webkit-scrollbar": { display: "none" } }}
    >
      <Tooltip
        content={
          <HStack gap={1}>
            <Text>Show trace summary</Text>
            <Kbd>O</Kbd>
          </HStack>
        }
        positioning={{ placement: "bottom" }}
      >
        <Button
          size="sm"
          variant="ghost"
          borderRadius={0}
          borderBottomWidth="2px"
          borderBottomColor={
            activeTab === "summary" ? "blue.solid" : "transparent"
          }
          color={activeTab === "summary" ? "fg" : "fg.muted"}
          fontWeight={activeTab === "summary" ? "semibold" : "medium"}
          onClick={() => onTabChange("summary")}
          paddingX={3}
          paddingY={0}
          height="38px"
          flexShrink={0}
          gap={1.5}
        >
          Trace
          <Kbd>O</Kbd>
          {traceId ? (
            <DrawerTabPresenceDot traceId={traceId} tab="summary" />
          ) : null}
        </Button>
      </Tooltip>

      <Tooltip
        content={
          <HStack gap={1}>
            <Text>Token-efficient summary for an LLM</Text>
            <Kbd>L</Kbd>
          </HStack>
        }
        positioning={{ placement: "bottom" }}
      >
        <Button
          size="sm"
          variant="ghost"
          borderRadius={0}
          borderBottomWidth="2px"
          borderBottomColor={
            activeTab === "llm" ? "purple.solid" : "transparent"
          }
          color={activeTab === "llm" ? "purple.fg" : "fg.muted"}
          fontWeight={activeTab === "llm" ? "semibold" : "medium"}
          onClick={() => onTabChange("llm")}
          paddingX={3}
          paddingY={0}
          height="38px"
          flexShrink={0}
          gap={1.5}
        >
          LLM
          <Kbd>L</Kbd>
          {traceId ? (
            <DrawerTabPresenceDot traceId={traceId} tab="llm" />
          ) : null}
        </Button>
      </Tooltip>

      {/* Prompts tab — only when this trace used managed prompts. The
          chip in the header is the lightweight peek; this tab is the full
          rollup grouped by prompt + version. */}
      {promptCount > 0 && (
        <Tooltip
          content={
            <HStack gap={1}>
              <Text>Prompts used in this trace</Text>
              <Kbd>P</Kbd>
            </HStack>
          }
          positioning={{ placement: "bottom" }}
        >
          <Button
            size="sm"
            variant="ghost"
            borderRadius={0}
            borderBottomWidth="2px"
            borderBottomColor={
              activeTab === "prompts" ? "blue.solid" : "transparent"
            }
            color={activeTab === "prompts" ? "fg" : "fg.muted"}
            fontWeight={activeTab === "prompts" ? "semibold" : "medium"}
            onClick={() => onTabChange("prompts")}
            paddingX={3}
            paddingY={0}
            height="38px"
            flexShrink={0}
            gap={1.5}
          >
            <Icon as={LuFileText} boxSize={3.5} />
            Prompts
            <Kbd>P</Kbd>
            <Badge size="xs" variant="subtle" colorPalette="blue">
              {promptCount}
            </Badge>
            {traceId ? (
              <DrawerTabPresenceDot traceId={traceId} tab="prompts" />
            ) : null}
          </Button>
        </Tooltip>
      )}

      {/* Pinned span tabs — first N inline, the rest collapse into a dropdown
          to keep the strip readable when many spans are pinned. */}
      {(() => {
        const overflowing = pinnedSpans.length > MAX_INLINE_PINNED;
        const inlineCount = overflowing
          ? INLINE_KEEP_WHEN_OVERFLOW
          : pinnedSpans.length;
        const inline = pinnedSpans.slice(0, inlineCount);
        const overflow = overflowing ? pinnedSpans.slice(inlineCount) : [];
        return (
          <>
            {inline.map((span) => {
              const isActive =
                activeTab === "span" && selectedSpan?.spanId === span.spanId;
              return (
                <SpanTab
                  key={span.spanId}
                  span={span}
                  isActive={isActive}
                  onClick={() => onSelectSpan(span.spanId)}
                  onHover={() => prefetchSpan(span.spanId)}
                  actionIcon={<Icon as={LuPinOff} boxSize={3} />}
                  actionLabel="Unpin span tab"
                  onAction={() => onUnpinSpan(span.spanId)}
                  presence={
                    traceId ? (
                      <SpanFocusPresenceDot
                        traceId={traceId}
                        spanId={span.spanId}
                      />
                    ) : null
                  }
                />
              );
            })}
            {overflow.length > 0 && (
              <PinnedSpanOverflowMenu
                spans={overflow}
                activeSpanId={
                  activeTab === "span" ? (selectedSpan?.spanId ?? null) : null
                }
                onSelectSpan={onSelectSpan}
                onUnpinSpan={onUnpinSpan}
              />
            )}
          </>
        );
      })()}

      {/* Ephemeral span tab — only if selected span is not pinned */}
      {selectedSpan && !isSelectedPinned && (
        <SpanTab
          span={selectedSpan}
          isActive={activeTab === "span"}
          onClick={() => onTabChange("span")}
          actionIcon={<Icon as={LuPin} boxSize={3} />}
          actionLabel="Pin span tab"
          onAction={() => onPinSpan(selectedSpan.spanId)}
          secondaryActionIcon={<Icon as={LuX} boxSize={3} />}
          secondaryActionLabel="Close span tab"
          onSecondaryAction={onCloseSpanTab}
          presence={
            traceId ? (
              <SpanFocusPresenceDot
                traceId={traceId}
                spanId={selectedSpan.spanId}
              />
            ) : null
          }
        />
      )}
    </HStack>
  );
});

interface SpanTabProps {
  span: SpanTreeNode;
  isActive: boolean;
  onClick: () => void;
  onHover?: () => void;
  actionIcon: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  secondaryActionIcon?: React.ReactNode;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  presence?: React.ReactNode;
}

function SpanTab({
  span,
  isActive,
  onClick,
  onHover,
  actionIcon,
  actionLabel,
  onAction,
  secondaryActionIcon,
  secondaryActionLabel,
  onSecondaryAction,
  presence,
}: SpanTabProps) {
  const activeBorderColor =
    (SPAN_TYPE_COLORS[span.type ?? "span"] as string) ?? "gray.solid";
  return (
    <Tooltip
      content={`${span.name} · ${span.spanId}`}
      positioning={{ placement: "bottom" }}
      openDelay={400}
    >
      <HStack
        gap={1.5}
        paddingX={3}
        paddingY={0}
        height="38px"
        flexShrink={0}
        borderRadius={0}
        borderBottomWidth="2px"
        borderBottomColor={isActive ? activeBorderColor : "transparent"}
        color={isActive ? "fg" : "fg.muted"}
        fontWeight={isActive ? "semibold" : "normal"}
        cursor="pointer"
        onClick={onClick}
        onMouseEnter={onHover}
        onFocus={onHover}
        _hover={{ bg: "bg.muted", color: "fg" }}
        transition="background 0.12s ease, color 0.12s ease"
      >
        <SpanTypeBadge type={span.type ?? "span"} />
        <Text
          textStyle="xs"
          color="inherit"
          fontWeight="inherit"
          maxWidth="180px"
          truncate
          fontFamily="mono"
        >
          {span.name}
        </Text>

        {span.type === "llm" && span.model != null && (
          <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
            {abbreviateModel(span.model)}
          </Text>
        )}

        <Text textStyle="2xs" color="fg.subtle">
          {formatDuration(span.durationMs)}
        </Text>

        {span.status === "error" && (
          <Circle size="6px" bg="red.solid" flexShrink={0} />
        )}

        {presence}

        <Tooltip content={actionLabel} positioning={{ placement: "top" }}>
          <Flex
            as="button"
            align="center"
            onClick={(e: React.MouseEvent) => {
              e.stopPropagation();
              onAction();
            }}
            aria-label={actionLabel}
            color="fg.subtle"
            paddingX={1.5}
            paddingY={1}
            borderRadius="sm"
            _hover={{ color: "fg", bg: "bg.emphasized" }}
          >
            {actionIcon}
          </Flex>
        </Tooltip>

        {secondaryActionIcon && onSecondaryAction && (
          <Tooltip
            content={secondaryActionLabel ?? ""}
            positioning={{ placement: "top" }}
          >
            <Flex
              as="button"
              align="center"
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                onSecondaryAction();
              }}
              aria-label={secondaryActionLabel}
              color="fg.subtle"
              paddingX={1}
              borderRadius="sm"
              _hover={{ color: "fg", bg: "bg.emphasized" }}
            >
              {secondaryActionIcon}
            </Flex>
          </Tooltip>
        )}
      </HStack>
    </Tooltip>
  );
}

function SpanTypeBadge({ type }: { type: string }) {
  const palette = SPAN_TYPE_PALETTE[type] ?? "gray";
  const label = type === "llm" || type === "rag" ? type.toUpperCase() : type;
  return (
    <Badge
      size="sm"
      variant="subtle"
      colorPalette={palette}
      flexShrink={0}
      borderRadius="md"
      fontWeight="medium"
      textTransform="capitalize"
      letterSpacing="0.01em"
    >
      {label}
    </Badge>
  );
}

interface PinnedSpanOverflowMenuProps {
  spans: SpanTreeNode[];
  activeSpanId: string | null;
  onSelectSpan: (spanId: string) => void;
  onUnpinSpan: (spanId: string) => void;
}

/**
 * Dropdown picker for pinned spans that overflowed the inline tab strip.
 * Each menu item behaves like a tab row: clicking the body selects the span,
 * the unpin button on the right removes it without closing the menu.
 */
function PinnedSpanOverflowMenu({
  spans,
  activeSpanId,
  onSelectSpan,
  onUnpinSpan,
}: PinnedSpanOverflowMenuProps) {
  const hasActive = spans.some((s) => s.spanId === activeSpanId);
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button
          size="sm"
          variant="ghost"
          borderRadius={0}
          borderBottomWidth="2px"
          borderBottomColor={hasActive ? "blue.solid" : "transparent"}
          color={hasActive ? "fg" : "fg.muted"}
          fontWeight={hasActive ? "semibold" : "medium"}
          paddingX={3}
          paddingY={0}
          height="38px"
          flexShrink={0}
          gap={1.5}
        >
          <Text textStyle="xs">+{spans.length} more</Text>
          <Icon as={LuChevronDown} boxSize={3} />
        </Button>
      </Menu.Trigger>
      <Menu.Content minWidth="280px">
        {spans.map((span) => {
          const isActive = span.spanId === activeSpanId;
          return (
            <Menu.Item
              key={span.spanId}
              value={span.spanId}
              onClick={() => onSelectSpan(span.spanId)}
              bg={isActive ? "bg.muted" : undefined}
            >
              <HStack flex={1} gap={2} minWidth={0}>
                <SpanTypeBadge type={span.type ?? "span"} />
                <Text
                  textStyle="xs"
                  fontFamily="mono"
                  truncate
                  flex={1}
                  fontWeight={isActive ? "semibold" : "normal"}
                >
                  {span.name}
                </Text>
                <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
                  {formatDuration(span.durationMs)}
                </Text>
                {span.status === "error" && (
                  <Circle size="6px" bg="red.solid" flexShrink={0} />
                )}
                <Tooltip
                  content="Unpin span tab"
                  positioning={{ placement: "top" }}
                >
                  <Flex
                    as="button"
                    align="center"
                    onClick={(e: React.MouseEvent) => {
                      e.stopPropagation();
                      onUnpinSpan(span.spanId);
                    }}
                    aria-label="Unpin span tab"
                    color="fg.subtle"
                    paddingX={1.5}
                    paddingY={1}
                    borderRadius="sm"
                    _hover={{ color: "fg", bg: "bg.emphasized" }}
                  >
                    <Icon as={LuPinOff} boxSize={3} />
                  </Flex>
                </Tooltip>
              </HStack>
            </Menu.Item>
          );
        })}
      </Menu.Content>
    </Menu.Root>
  );
}
