import { formatDuration } from "@langwatch/design-system/display-formatters";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Button,
  Circle,
  Flex,
  HStack,
  Icon,
  Text,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { memo, useMemo, useRef } from "react";
import {
  LuChevronDown,
  LuPanelBottomClose,
  LuPanelBottomOpen,
  LuPanelRightClose,
  LuPanelRightOpen,
  LuPin,
  LuPinOff,
  LuX,
} from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";

import { useOverflowVisibility } from "../../../../behavior/explorer/use-overflow-visibility.ts";
import {
  selectPeersMatching,
  usePresenceStore,
} from "../../../../behavior/presence/presence-store.ts";
import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { OverflowMenu } from "../../../elements/explorer/shared/overflow-menu.tsx";
import { PresenceMarker } from "../../../elements/presence/presence-marker.tsx";
import { usePrefetchSpanDetail } from "../hooks/use-prefetch-span-detail.ts";
import { spanTypeColor } from "../utils/span-type-color.ts";

/**
 * Tab / menu label for a span: generic tool spans (claude_code.tool ...)
 * append WHICH tool ran so five identical tool tabs stay tellable apart.
 */
function spanTabLabel(span: {
  name: string | null;
  spanId: string;
  toolName?: string | null;
}): string {
  const base = span.name ?? span.spanId;
  return span.toolName ? `${base} · ${span.toolName}` : base;
}

/**
 * When more than this many spans are pinned, collapse the tail into a "+N more"
 * dropdown so the tab strip doesn't run away into a horizontal scrollbar swamp.
 */
const MAX_INLINE_PINNED = 4;
const INLINE_KEEP_WHEN_OVERFLOW = 3;

/**
 * `data-overflow-id` for the right-aligned instrumentation scope chip.
 */
const RIGHT_SLOT_OVERFLOW_ID = "right-slot:instrumentation";

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
  spanTree: SpanTreeNode[];
  /**
   * Optional right-aligned slot rendered after all tabs — used to
   * surface things like the instrumentation scope or other secondary
   * metadata without claiming its own row.
   */
  rightSlot?: React.ReactNode;
  /**
   * Position of the Details pane in its `<PanelGroup>`. Drives where the collapse
   * toggle sits — leftmost for a right-side pane (the horizontal split), rightmost for
   * a bottom-stacked pane (vertical layout).
   */
  collapsePosition?: "leading" | "trailing";
}

function SpanFocusPresenceDot({ traceId, spanId }: { traceId: string; spanId: string }) {
  const peers = usePresenceStore(
    useShallow((s) =>
      selectPeersMatching(
        s,
        (session) =>
          session.location.route.traceId === traceId && session.location.route.spanId === spanId,
      ),
    ),
  );
  if (peers.length === 0) return null;
  return <PresenceMarker peers={peers} size={16} tooltipSuffix="this span" />;
}

/** Resolves each pinned span id to its tree node, dropping any that no longer exist. */
function resolvePinnedSpans(pinnedSpanIds: string[], spanTree: SpanTreeNode[]): SpanTreeNode[] {
  return pinnedSpanIds
    .map((id) => spanTree.find((s) => s.spanId === id))
    .filter((s): s is SpanTreeNode => s != null);
}

type TabDescriptor = {
  id: string;
  activeId?: string;
  label: string;
  onSelect: () => void;
  render: () => React.ReactNode;
  /** Dropdown-row contents when this tab is folded into the menu. */
  menuContent: React.ReactNode;
};

function TabMenuLabel({ span }: { span: SpanTreeNode }) {
  return (
    <HStack gap={1.5}>
      <Text truncate maxWidth="200px">
        {spanTabLabel(span)}
      </Text>
    </HStack>
  );
}

function presenceFor({ traceId, spanId }: { traceId: string | null | undefined; spanId: string }) {
  return traceId ? <SpanFocusPresenceDot traceId={traceId} spanId={spanId} /> : null;
}

function pinnedTabDescriptor({
  span,
  traceId,
  isActive,
  onSelect,
  onHover,
  onUnpin,
}: {
  span: SpanTreeNode;
  traceId: string | null | undefined;
  isActive: boolean;
  onSelect: () => void;
  onHover: () => void;
  onUnpin: () => void;
}): TabDescriptor {
  const id = `span:${span.spanId}`;
  return {
    id,
    activeId: isActive ? id : undefined,
    label: spanTabLabel(span),
    onSelect,
    render: () => (
      <SpanTab
        overflowId={id}
        span={span}
        isActive={isActive}
        onClick={onSelect}
        onHover={onHover}
        actionIcon={<Icon as={LuPinOff} boxSize={3} />}
        actionLabel="Unpin span tab"
        onAction={onUnpin}
        presence={presenceFor({ traceId, spanId: span.spanId })}
      />
    ),
    menuContent: <TabMenuLabel span={span} />,
  };
}

/** The selected span's tab while it is not pinned: pin it, or close it. */
function ephemeralTabDescriptor({
  span,
  traceId,
  onSelect,
  onPin,
  onClose,
}: {
  span: SpanTreeNode;
  traceId: string | null | undefined;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}): TabDescriptor {
  const id = "span:ephemeral";
  return {
    id,
    activeId: id,
    label: spanTabLabel(span),
    onSelect,
    render: () => (
      <SpanTab
        overflowId={id}
        span={span}
        isActive
        onClick={onSelect}
        actionIcon={<Icon as={LuPin} boxSize={3} />}
        actionLabel="Pin span tab"
        onAction={onPin}
        secondaryActionIcon={<Icon as={LuX} boxSize={3} />}
        secondaryActionLabel="Close span tab"
        onSecondaryAction={onClose}
        presence={presenceFor({ traceId, spanId: span.spanId })}
      />
    ),
    menuContent: <TabMenuLabel span={span} />,
  };
}

/**
 * Shows or hides the details pane from the tab row's edge. The icon follows the
 * pane's edge: right for a side-by-side split, bottom for a stacked one.
 */
function DetailCollapseToggle({
  collapsed,
  position,
  onToggle,
}: {
  collapsed: boolean;
  position: "leading" | "trailing";
  onToggle: () => void;
}) {
  const rightEdgeIcon = collapsed ? LuPanelRightOpen : LuPanelRightClose;
  const bottomEdgeIcon = collapsed ? LuPanelBottomOpen : LuPanelBottomClose;
  const label = collapsed ? "Show details" : "Hide details";
  return (
    <Tooltip
      content={label}
      positioning={{ placement: position === "leading" ? "right" : "left" }}
      openDelay={400}
    >
      <Flex
        as="button"
        align="center"
        justify="center"
        paddingX={1.5}
        color="fg.muted"
        cursor="pointer"
        _hover={{ color: "fg" }}
        aria-label={label}
        onClick={onToggle}
        flexShrink={0}
      >
        <Icon as={position === "leading" ? rightEdgeIcon : bottomEdgeIcon} boxSize={3.5} />
      </Flex>
    </Tooltip>
  );
}

export const SpanTabBar = memo(function SpanTabBar({
  spanTree,
  rightSlot,
  collapsePosition = "leading",
}: SpanTabBarProps) {
  const traceId = useTraceDrawer((s) => s.traceId);
  const selectedSpanId = useTraceDrawer((s) => s.selectedSpanId);
  const pinnedSpanIds = useTraceDrawer((s) => s.pinnedSpanIds);
  const selectSpan = useTraceDrawer((s) => s.selectSpan);
  const clearSpan = useTraceDrawer((s) => s.clearSpan);
  const pinSpan = useTraceDrawer((s) => s.pinSpan);
  const unpinSpan = useTraceDrawer((s) => s.unpinSpan);
  const prefetchSpan = usePrefetchSpanDetail();
  // The Details pane no longer has its own header — the collapse
  // affordance sits at the leftmost edge of this tab row (mirrors
  // Chrome DevTools' "Headers / Cookies / Request / Response" row).
  const detailCollapsed = useTraceDrawer((s) => s.paneState.spanDetail.collapsed);
  const togglePaneCollapsed = useTraceDrawer((s) => s.togglePaneCollapsed);
  const collapseToggle = (
    <DetailCollapseToggle
      collapsed={detailCollapsed}
      position={collapsePosition}
      onToggle={() => togglePaneCollapsed("spanDetail")}
    />
  );

  const selectedSpan = useMemo(
    () => (selectedSpanId ? (spanTree.find((s) => s.spanId === selectedSpanId) ?? null) : null),
    [selectedSpanId, spanTree],
  );

  const pinnedSpans = useMemo(
    () => resolvePinnedSpans(pinnedSpanIds, spanTree),
    [pinnedSpanIds, spanTree],
  );

  const isSelectedPinned = selectedSpan
    ? pinnedSpans.some((s) => s.spanId === selectedSpan.spanId)
    : false;

  const overflowing = pinnedSpans.length > MAX_INLINE_PINNED;
  const inlineCount = overflowing ? INLINE_KEEP_WHEN_OVERFLOW : pinnedSpans.length;
  // Both slices are memoized: they feed `tabDescriptors` → `tabIds` →
  // `useOverflowVisibility`, whose effect resets state whenever the items array changes
  // by reference.
  const inlinePinned = useMemo(() => pinnedSpans.slice(0, inlineCount), [pinnedSpans, inlineCount]);
  const overflowPinned = useMemo(
    () => (overflowing ? pinnedSpans.slice(inlineCount) : []),
    [pinnedSpans, inlineCount, overflowing],
  );

  // One descriptor list, so useOverflowVisibility can fold whatever does not fit into
  // the kebab menu: pinned spans in pin order, then the selected span unless pinned.
  const tabDescriptors = useMemo(() => {
    const pinned = inlinePinned.map((span) =>
      pinnedTabDescriptor({
        span,
        traceId,
        isActive: selectedSpan?.spanId === span.spanId,
        onSelect: () => selectSpan(span.spanId),
        onHover: () => prefetchSpan(span.spanId),
        onUnpin: () => unpinSpan(span.spanId),
      }),
    );
    if (!selectedSpan || isSelectedPinned) return pinned;
    return [
      ...pinned,
      ephemeralTabDescriptor({
        span: selectedSpan,
        traceId,
        onSelect: () => selectSpan(selectedSpan.spanId),
        onPin: () => pinSpan(selectedSpan.spanId),
        onClose: clearSpan,
      }),
    ];
  }, [
    traceId,
    inlinePinned,
    selectedSpan,
    isSelectedPinned,
    selectSpan,
    prefetchSpan,
    unpinSpan,
    pinSpan,
    clearSpan,
  ]);

  const tabIds = useMemo(() => {
    const ids = tabDescriptors.map((d) => d.id);
    // RightSlot lives in the same scroller and gets the same
    // measurement treatment as the tabs. Last in DOM, so the
    // left-to-right cutoff iterator sees it last → it's always the
    // first thing cut when the row gets tight.
    if (rightSlot) ids.push(RIGHT_SLOT_OVERFLOW_ID);
    return ids;
  }, [tabDescriptors, rightSlot]);
  const activeOverflowId = tabDescriptors.find((d) => d.activeId)?.id ?? null;
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Reserve room for kebab trigger + optional rightSlot + the pinned-span overflow menu
  // + the trailing collapse toggle. 96px gives enough headroom that the last visible
  // tab doesn't bleed under those controls on a narrow drawer.
  const hiddenTabIds = useOverflowVisibility({
    scrollerRef,
    items: tabIds,
    activeId: activeOverflowId,
    reservePx: 0,
  });

  return (
    <HStack
      gap="5px"
      paddingLeft={collapsePosition === "leading" ? 2 : 4}
      paddingRight={collapsePosition === "leading" ? 4 : 2}
      borderBottomWidth="1px"
      borderColor="border"
      flexShrink={0}
      align="stretch"
      minHeight="38px"
      bg={{ base: "bg.surface", _dark: "bg.panel" }}
    >
      {collapsePosition === "leading" && collapseToggle}

      <HStack
        ref={scrollerRef}
        gap="5px"
        flex={1}
        minWidth={0}
        flexWrap="nowrap"
        overflowX="hidden"
        align="stretch"
      >
        {tabDescriptors.map((descriptor) => (
          <Flex
            key={descriptor.id}
            display={hiddenTabIds.has(descriptor.id) ? "none" : "flex"}
            align="stretch"
            flexShrink={0}
          >
            {descriptor.render()}
          </Flex>
        ))}
        {overflowPinned.length > 0 && (
          <PinnedSpanOverflowMenu
            spans={overflowPinned}
            activeSpanId={selectedSpan?.spanId ?? null}
            onSelectSpan={selectSpan}
            onUnpinSpan={unpinSpan}
          />
        )}
        {/* `marginLeft: auto` keeps the scope chip + overflow kebab flush-right. The chip hides
          first under space pressure since its `data-overflow-id` sits last in DOM order. */}
        <Flex marginLeft="auto" align="center" gap="5px" flexShrink={0} minWidth={0}>
          {rightSlot ? (
            <Flex
              data-overflow-id={RIGHT_SLOT_OVERFLOW_ID}
              display={hiddenTabIds.has(RIGHT_SLOT_OVERFLOW_ID) ? "none" : "flex"}
              align="center"
              flexShrink={0}
            >
              {rightSlot}
            </Flex>
          ) : null}
          <Flex align="center" flexShrink={0}>
            <OverflowMenu
              items={tabDescriptors
                .filter((d) => hiddenTabIds.has(d.id))
                .map((d) => ({
                  id: d.id,
                  label: d.label,
                  content: d.menuContent,
                }))}
              activeId={activeOverflowId}
              onSelect={(id) => {
                const descriptor = tabDescriptors.find((d) => d.id === id);
                descriptor?.onSelect();
              }}
              ariaLabel="Show more tabs"
            />
          </Flex>
        </Flex>
      </HStack>
      {collapsePosition === "trailing" && (
        <Flex align="center" flexShrink={0} paddingLeft={2}>
          {collapseToggle}
        </Flex>
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
  /** Marker for `useOverflowVisibility` measurement. */
  overflowId?: string;
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
  overflowId,
}: SpanTabProps) {
  const activeBorderColor = spanTypeColor(span.type);
  return (
    <Tooltip
      content={
        // spanTabLabel already falls back to the span id for nameless
        // spans — appending it again would read `id · id`.
        span.name ? `${spanTabLabel(span)} · ${span.spanId}` : spanTabLabel(span)
      }
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
        data-overflow-id={overflowId}
      >
        <SpanTypeBadge type={span.type ?? "span"} />
        <Text textStyle="xs" color="inherit" fontWeight="inherit" maxWidth="180px" truncate>
          {spanTabLabel(span)}
        </Text>

        {span.type === "llm" && span.model != null && (
          <Text textStyle="2xs" color="fg.subtle">
            {span.model}
          </Text>
        )}

        <Text textStyle="2xs" color="fg.subtle">
          {formatDuration(span.durationMs)}
        </Text>

        {span.status === "error" && <Circle size="6px" bg="red.solid" flexShrink={0} />}

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
          <Tooltip content={secondaryActionLabel ?? ""} positioning={{ placement: "top" }}>
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
  // Span types in the catalog (llm / tool / agent / …) keep the `subtle` colour-tinted
  // look so they read as the curated palette the rest of the drawer uses.
  const mappedPalette = SPAN_TYPE_PALETTE[type];
  const label = type === "llm" || type === "rag" ? type.toUpperCase() : type;
  return (
    <Badge
      size="sm"
      variant={mappedPalette ? "subtle" : "outline"}
      colorPalette={mappedPalette ?? "gray"}
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
 * Each menu item behaves like a tab row: clicking the body selects the
 * span, the unpin button on the right removes it without closing the menu.
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
                  truncate
                  flex={1}
                  fontWeight={isActive ? "semibold" : "normal"}
                >
                  {spanTabLabel(span)}
                </Text>
                <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
                  {formatDuration(span.durationMs)}
                </Text>
                {span.status === "error" && <Circle size="6px" bg="red.solid" flexShrink={0} />}
                <Tooltip content="Unpin span tab" positioning={{ placement: "top" }}>
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
