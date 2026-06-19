import {
  Badge,
  Button,
  Circle,
  Flex,
  HStack,
  Icon,
  Text,
} from "@chakra-ui/react";
import { memo, useMemo, useRef } from "react";
import {
  LuChevronDown,
  LuChevronRight,
  LuFileText,
  LuPanelBottomClose,
  LuPanelBottomOpen,
  LuPanelRightClose,
  LuPanelRightOpen,
  LuPin,
  LuPinOff,
  LuX,
} from "react-icons/lu";
import { useShallow } from "zustand/react/shallow";
import { Kbd } from "~/components/ops/shared/Kbd";
import { Menu } from "~/components/ui/menu";
import { Tooltip } from "~/components/ui/tooltip";
import { PresenceMarker } from "~/features/presence/components/PresenceMarker";
import {
  selectPeersMatching,
  usePresenceStore,
} from "~/features/presence/stores/presenceStore";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { useOverflowVisibility } from "../../hooks/useOverflowVisibility";
import { usePrefetchSpanDetail } from "../../hooks/usePrefetchSpanDetail";
import { type DrawerTab, useDrawerStore } from "../../stores/drawerStore";
import {
  abbreviateModel,
  formatDuration,
  SPAN_TYPE_COLORS,
} from "../../utils/formatters";
import { OverflowMenu } from "../shared/OverflowMenu";

/**
 * When more than this many spans are pinned, collapse the tail into a
 * "+N more" dropdown so the tab strip doesn't run away into a horizontal
 * scrollbar swamp. We always keep the first three inline so the user has a
 * stable anchor on the left, then the menu picks up the rest.
 */
const MAX_INLINE_PINNED = 4;
const INLINE_KEEP_WHEN_OVERFLOW = 3;

/**
 * `data-overflow-id` for the right-aligned instrumentation scope chip.
 * The chip lives inside the scroller (right-aligned via `marginLeft:
 * auto` on its wrapper) so the SAME `useOverflowVisibility` pass that
 * decides which tabs hide also decides whether the chip fits. Module
 * scope dodges TDZ for the `tabIds` useMemo factory that references it.
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
   * Position of the Details pane in its `<PanelGroup>`. Drives where
   * the collapse toggle sits — leftmost for a right-side pane (the
   * horizontal split), rightmost for a bottom-stacked pane (vertical
   * layout). Mirrors how Chrome DevTools' panel-position chooser
   * decides which edge of the tab row gets the disclosure icon.
   */
  collapsePosition?: "leading" | "trailing";
}

function SpanFocusPresenceDot({
  traceId,
  spanId,
}: {
  traceId: string;
  spanId: string;
}) {
  const peers = usePresenceStore(
    useShallow((s) =>
      selectPeersMatching(
        s,
        (session) =>
          session.location.route.traceId === traceId &&
          session.location.route.spanId === spanId,
      ),
    ),
  );
  if (peers.length === 0) return null;
  return <PresenceMarker peers={peers} size={16} tooltipSuffix="this span" />;
}

export const SpanTabBar = memo(function SpanTabBar({
  spanTree,
  rightSlot,
  collapsePosition = "leading",
}: SpanTabBarProps) {
  const traceId = useDrawerStore((s) => s.traceId);
  const selectedSpanId = useDrawerStore((s) => s.selectedSpanId);
  const pinnedSpanIds = useDrawerStore((s) => s.pinnedSpanIds);
  const selectSpan = useDrawerStore((s) => s.selectSpan);
  const clearSpan = useDrawerStore((s) => s.clearSpan);
  const pinSpan = useDrawerStore((s) => s.pinSpan);
  const unpinSpan = useDrawerStore((s) => s.unpinSpan);
  const prefetchSpan = usePrefetchSpanDetail();
  // The Details pane no longer has its own header — the collapse
  // affordance sits at the leftmost edge of this tab row (mirrors
  // Chrome DevTools' "Headers / Cookies / Request / Response" row).
  const detailCollapsed = useDrawerStore(
    (s) => s.paneState.spanDetail.collapsed,
  );
  const togglePaneCollapsed = useDrawerStore((s) => s.togglePaneCollapsed);
  // Icon orientation tracks the pane's edge: horizontal layout puts the
  // detail pane on the right, so the collapse chevron points
  // right (LuPanelRight*); vertical stacks the detail pane on the
  // *bottom*, so the icon shows a bottom-docked panel (LuPanelBottom*).
  // The previous LuPanelTop* set was inverted — it depicted the panel
  // docked at the top, which read backwards for a bottom-docked pane:
  // collapsed showed the "panel popping down from above" arrow, expanded
  // showed "panel sliding up". With LuPanelBottom*: collapsed (panel
  // hidden) shows the bottom panel ready to spring up; expanded shows
  // the bottom panel ready to collapse down.
  const isHorizontalSplit = collapsePosition === "leading";
  const CollapseToggleIcon = isHorizontalSplit
    ? detailCollapsed
      ? LuPanelRightOpen
      : LuPanelRightClose
    : detailCollapsed
      ? LuPanelBottomOpen
      : LuPanelBottomClose;

  const collapseToggle = (
    <Tooltip
      content={detailCollapsed ? "Show details" : "Hide details"}
      positioning={{
        placement: collapsePosition === "leading" ? "right" : "left",
      }}
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
        aria-label={detailCollapsed ? "Show details" : "Hide details"}
        onClick={() => togglePaneCollapsed("spanDetail")}
        flexShrink={0}
      >
        <Icon as={CollapseToggleIcon} boxSize={3.5} />
      </Flex>
    </Tooltip>
  );

  const selectedSpan = useMemo(
    () =>
      selectedSpanId
        ? (spanTree.find((s) => s.spanId === selectedSpanId) ?? null)
        : null,
    [selectedSpanId, spanTree],
  );

  const pinnedSpans = useMemo(
    () =>
      pinnedSpanIds
        .map((id) => spanTree.find((s) => s.spanId === id))
        .filter((s): s is SpanTreeNode => s != null),
    [pinnedSpanIds, spanTree],
  );

  const isSelectedPinned = selectedSpan
    ? pinnedSpans.some((s) => s.spanId === selectedSpan.spanId)
    : false;

  const overflowing = pinnedSpans.length > MAX_INLINE_PINNED;
  const inlineCount = overflowing
    ? INLINE_KEEP_WHEN_OVERFLOW
    : pinnedSpans.length;
  // Both slices are memoized: they feed `tabDescriptors` → `tabIds` →
  // `useOverflowVisibility`, whose effect resets state whenever the
  // items array changes by reference. Before this memo each render
  // produced a fresh slice, churning the dep, resetting the hidden
  // set, triggering another render — infinite loop that the error
  // boundary swallowed silently. The visible symptom was that closing
  // the drawer didn't tear down its DOM, because the boundary kept
  // re-mounting the subtree faster than the URL change could unmount
  // the parent.
  const inlinePinned = useMemo(
    () => pinnedSpans.slice(0, inlineCount),
    [pinnedSpans, inlineCount],
  );
  const overflowPinned = useMemo(
    () => (overflowing ? pinnedSpans.slice(inlineCount) : []),
    [pinnedSpans, inlineCount, overflowing],
  );

  // Build a unified descriptor list (static tabs + dynamic span tabs) so
  // `useOverflowVisibility` can collapse anything that doesn't fit on
  // the strip into a single kebab menu — same pattern the viz tab row
  // uses. Without this the strip just falls back to horizontal scroll,
  // which on a narrow drawer hid Summary and LLM-Optimized behind a
  // hidden-scrollbar overflow the user couldn't see.
  type TabDescriptor = {
    id: string;
    activeId?: string;
    label: string;
    onSelect: () => void;
    render: () => React.ReactNode;
    /** Dropdown-row contents when this tab is folded into the menu. */
    menuContent: React.ReactNode;
  };
  // After the trace-view redesign the SpanTabBar carries only
  // span-scope tabs: pinned spans (rendered first, in pin order) and
  // the currently-selected ephemeral span (rendered at the trailing
  // edge if it isn't already pinned). Summary / LLM-Optimized / Prompts
  // moved out — Summary is its own DrawerViewMode in ModeSwitch; LLM
  // and prompt views are auto-selected inside SpanDetailPane based on
  // the selected span's kind, so there's nothing for the user to pick
  // here.
  const tabDescriptors: TabDescriptor[] = useMemo(() => {
    const list: TabDescriptor[] = [];
    inlinePinned.forEach((span) => {
      const id = `span:${span.spanId}`;
      const isActive = selectedSpan?.spanId === span.spanId;
      list.push({
        id,
        activeId: isActive ? id : undefined,
        label: span.name ?? span.spanId,
        onSelect: () => selectSpan(span.spanId),
        render: () => (
          <SpanTab
            overflowId={id}
            span={span}
            isActive={isActive}
            onClick={() => selectSpan(span.spanId)}
            onHover={() => prefetchSpan(span.spanId)}
            actionIcon={<Icon as={LuPinOff} boxSize={3} />}
            actionLabel="Unpin span tab"
            onAction={() => unpinSpan(span.spanId)}
            presence={
              traceId ? (
                <SpanFocusPresenceDot traceId={traceId} spanId={span.spanId} />
              ) : null
            }
          />
        ),
        menuContent: (
          <HStack gap={1.5}>
            <Text truncate maxWidth="200px">
              {span.name ?? span.spanId}
            </Text>
          </HStack>
        ),
      });
    });
    if (selectedSpan && !isSelectedPinned) {
      const id = "span:ephemeral";
      list.push({
        id,
        activeId: id,
        label: selectedSpan.name ?? selectedSpan.spanId,
        onSelect: () => selectSpan(selectedSpan.spanId),
        render: () => (
          <SpanTab
            overflowId={id}
            span={selectedSpan}
            isActive
            onClick={() => selectSpan(selectedSpan.spanId)}
            actionIcon={<Icon as={LuPin} boxSize={3} />}
            actionLabel="Pin span tab"
            onAction={() => pinSpan(selectedSpan.spanId)}
            secondaryActionIcon={<Icon as={LuX} boxSize={3} />}
            secondaryActionLabel="Close span tab"
            onSecondaryAction={clearSpan}
            presence={
              traceId ? (
                <SpanFocusPresenceDot
                  traceId={traceId}
                  spanId={selectedSpan.spanId}
                />
              ) : null
            }
          />
        ),
        menuContent: (
          <HStack gap={1.5}>
            <Text truncate maxWidth="200px">
              {selectedSpan.name ?? selectedSpan.spanId}
            </Text>
          </HStack>
        ),
      });
    }
    return list;
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
  // Reserve room for kebab trigger + optional rightSlot + the
  // pinned-span overflow menu + the trailing collapse toggle. 96px gives
  // enough headroom that the last visible tab doesn't bleed under those
  // controls on a narrow drawer.
  // No reservePx — the kebab + rightSlot wrapper is a natural-flow
  // child of the scroller (pushed right via `marginLeft: auto`), so
  // there's no fixed-position chrome to reserve space for.
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
        {/*
          Right-aligned cluster: instrumentation scope chip + the
          overflow kebab. `marginLeft: auto` on the wrapper consumes
          the row's leftover space so this cluster always sits
          flush-right (matching the operator expectation that the
          chip and the kebab belong at the rightmost edge of the
          strip, never inline with the tabs). When tabs overflow,
          the cluster slides right; when the row gets too tight for
          the chip, the cutoff iterator hides the chip first because
          its `data-overflow-id` sits last in DOM order.
        */}
        <Flex
          marginLeft="auto"
          align="center"
          gap="5px"
          flexShrink={0}
          minWidth={0}
        >
          {rightSlot ? (
            <Flex
              data-overflow-id={RIGHT_SLOT_OVERFLOW_ID}
              display={
                hiddenTabIds.has(RIGHT_SLOT_OVERFLOW_ID) ? "none" : "flex"
              }
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
        data-overflow-id={overflowId}
      >
        <SpanTypeBadge type={span.type ?? "span"} />
        <Text
          textStyle="xs"
          color="inherit"
          fontWeight="inherit"
          maxWidth="180px"
          truncate
        >
          {span.name}
        </Text>

        {span.type === "llm" && span.model != null && (
          <Text textStyle="2xs" color="fg.subtle">
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
  // Span types in the catalog (llm / tool / agent / …) keep the
  // `subtle` colour-tinted look so they read as the curated palette
  // the rest of the drawer uses. Anything outside the catalog (the
  // raw OTel SpanKind values "CLIENT", "SERVER", "INTERNAL",
  // "PRODUCER", "CONSUMER" that come through unmapped, plus future
  // custom types) falls through to a bordered `outline` variant on
  // the gray palette so it stays readable in dark mode — the prior
  // `subtle` + `gray` combination painted gray.fg on top of
  // gray.subtle which collapsed to a dark-on-dark blob in dark theme.
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
