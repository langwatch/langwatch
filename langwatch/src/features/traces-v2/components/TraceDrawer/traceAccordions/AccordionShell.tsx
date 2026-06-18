import { Accordion, Badge, Box, HStack, Icon, Text } from "@chakra-ui/react";
import { type ReactNode, useRef } from "react";
import { LuChevronDown } from "react-icons/lu";
import { PresenceSection } from "~/features/presence/components/PresenceSection";
import { SectionPresenceDot } from "~/features/presence/components/SectionPresenceDot";
import {
  getDrawerDensityTokens,
  useDensityStore,
} from "../../../stores/densityStore";
import { useSectionPresenceStore } from "./sectionPresence";

export function AccordionShell({
  children,
  value,
  onValueChange,
}: {
  children: ReactNode;
  value: string[];
  onValueChange: (next: string[]) => void;
}) {
  return (
    <Accordion.Root
      multiple
      value={value}
      onValueChange={(e) => onValueChange(e.value)}
    >
      {children}
    </Accordion.Root>
  );
}

/**
 * Accordion triggers pin at `top: 0` of their scroll container. In the
 * new pane layout the `SpanTabBar` lives **outside** the accordions'
 * scroll container — it's part of the Span Detail pane's header chrome.
 * Older versions of this file offset by the tab-bar height because
 * the bar shared the same scroll surface, which left a visible
 * empty band above each sticky section.
 */
const SPAN_TAB_BAR_HEIGHT_PX = 0;

export function Section({
  value,
  title,
  count,
  empty,
  children,
  isFirst,
  open,
  spotlightAnchor,
}: {
  value: string;
  title: string;
  count?: number;
  /**
   * When true (and there's no count), render an "(empty)" tag inline with the
   * title so users can see at a glance there's nothing inside without having
   * to expand.
   */
  empty?: boolean;
  children: ReactNode;
  isFirst?: boolean;
  /**
   * When provided, defers mounting `children` until the section has been
   * opened at least once. After first open, children stay mounted so toggling
   * collapsed/open is cheap. Omit to fall back to the eager-mount default.
   */
  open?: boolean;
  /**
   * When set, emits `data-spotlight=<value>` on the accordion item so the
   * drawer's show-once spotlight system can anchor to this section. Pass
   * only when the section actually has content — anchor presence in the
   * DOM is the spotlight's display condition.
   */
  spotlightAnchor?: string;
}) {
  const presenceTraceId = useSectionPresenceStore((s) => s.traceId);
  const presenceTab = useSectionPresenceStore((s) => s.tab);
  const trackPresence = !!(presenceTraceId && presenceTab);
  const hasOpenedRef = useRef(open ?? true);
  if (open) hasOpenedRef.current = true;
  const renderChildren = open === undefined || hasOpenedRef.current;
  const density = useDensityStore((s) => s.density);
  const tokens = getDrawerDensityTokens(density);
  return (
    <Accordion.Item
      value={value}
      border="0"
      data-section={value}
      data-section-label={title}
      data-section-count={count ?? ""}
      {...(spotlightAnchor ? { "data-spotlight": spotlightAnchor } : {})}
    >
      <Accordion.ItemTrigger
        width="100%"
        display="flex"
        // Pin both the HStack (with title + count) and the indicator
        // to the trigger's vertical centre. Without this, the indicator
        // inherits the trigger's default cross-axis alignment which
        // shifted with the chevron's rotation state — closed read as
        // "drifted down", open read as "drifted up".
        alignItems="center"
        paddingX={4}
        // +0.5 density step (~2px each side) over the raw token —
        // operator feedback: the section triggers felt cramped, this
        // gives the row a touch of breathing room without breaking
        // the rhythm with the ctx header above (which already runs
        // at `densityPaddingY + 0.5`).
        paddingY={tokens.sectionTriggerY + 0.5}
        // Solid bg under sticky so content scrolling underneath is
        // occluded — without it the title would overlap the content
        // beneath when pinned. `bg.surface` matches the drawer body.
        bg="bg.surface"
        color="fg.muted"
        borderTopWidth={isFirst ? "0" : "1px"}
        borderColor={{ base: "gray.200", _dark: "border.muted" }}
        transition="background 120ms ease, color 120ms ease"
        _hover={{ bg: "bg.softHover", color: "fg" }}
        // Open state keeps the same white bg AND the same `fg.muted`
        // title color as closed — operator feedback: promoting the
        // title color on expand made the "INPUT AND OUTPUT" labels
        // look heavier than their collapsed siblings, breaking the
        // calm read of the section list. The chevron rotation alone
        // signals state. A 1px bottom border still slips in so the
        // trigger reads as the open section's own header band.
        _open={{
          borderBottomWidth: "1px",
          borderBottomColor: { base: "gray.200", _dark: "border.muted" },
        }}
        cursor="pointer"
        // Each trigger pins flush with the SpanTabBar (no per-section
        // offset). The previous "Notion-style" stacking multiplied a
        // per-section index against the trigger height, which left a
        // visible gap above later sections whenever an earlier section
        // had already scrolled out of view — `position: sticky` only
        // pins within the Accordion.Item, so collapsed/scrolled-past
        // sections never actually occupy the space the offset reserved
        // for them. Same-top sticky gives a clean replacement on scroll.
        position="sticky"
        top={`${SPAN_TAB_BAR_HEIGHT_PX}px`}
        zIndex={1}
      >
        <HStack flex={1} gap={2}>
          <Text
            textStyle="2xs"
            fontWeight="semibold"
            color="inherit"
            textTransform="uppercase"
            letterSpacing="wider"
          >
            {title}
          </Text>
          {count != null && count > 0 && (
            <Badge size="xs" variant="subtle" colorPalette="gray">
              {count}
            </Badge>
          )}
          {empty && (count == null || count === 0) && (
            <Text textStyle="2xs" color="fg.subtle" fontStyle="italic">
              empty
            </Text>
          )}
          {trackPresence ? (
            <SectionPresenceDot
              traceId={presenceTraceId!}
              tab={presenceTab!}
              section={value}
            />
          ) : null}
        </HStack>
        {/* Custom indicator at a fixed 12px so it matches the close /
            expand icon in the LLM-Optimized header row above — the
            default `<Accordion.ItemIndicator>` inherits the trigger's
            font size and reads visibly larger than its neighbours.
            Explicit `_open` rotation because our own `display: flex`
            override won the cascade against the default slot recipe
            — the chevron would otherwise either not rotate at all,
            or rotate the wrong direction. Closed = chevron-down,
            open = rotate(180deg) = chevron-up.
            `alignSelf: center` keeps the icon anchored to the
            trigger's vertical midline through both states. */}
        <Accordion.ItemIndicator
          color="inherit"
          display="flex"
          alignItems="center"
          alignSelf="center"
          lineHeight={0}
          transition="transform 120ms ease"
          transformOrigin="center"
          transform="rotate(0deg)"
          _open={{ transform: "rotate(180deg)" }}
        >
          <Icon as={LuChevronDown} boxSize={3} />
        </Accordion.ItemIndicator>
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        {trackPresence ? (
          <PresenceSection id={value}>
            <Box
              paddingX={4}
              paddingY={tokens.sectionContentY}
              paddingBottom={tokens.sectionContentY + 1}
            >
              {renderChildren ? children : null}
            </Box>
          </PresenceSection>
        ) : (
          <Box paddingX={4} paddingY={2} paddingBottom={3}>
            {renderChildren ? children : null}
          </Box>
        )}
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}
