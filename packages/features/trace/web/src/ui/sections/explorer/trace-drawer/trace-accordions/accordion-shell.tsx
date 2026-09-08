import { Accordion, Badge, Box, HStack, Icon, Text } from "@chakra-ui/react";
import {
  PresenceSection,
  SectionPresenceDot,
} from "@langwatch/presence-web";
import { type ReactNode, useRef } from "react";
import { LuChevronDown, LuMessageSquare } from "react-icons/lu";
import { getDrawerDensityTokens, useDensityStore } from "../../../../../behavior/density.store.ts";
import { useSectionPresenceStore } from "../../../../../behavior/explorer/trace-drawer/trace-accordions/section-presence.ts";

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
    <Accordion.Root multiple value={value} onValueChange={(e) => onValueChange(e.value)}>
      {children}
    </Accordion.Root>
  );
}

/**
 * Accordion triggers pin at `top: 0` of their scroll container. In the new pane layout
 * the `SpanTabBar` lives **outside** the accordions' scroll container — it's part of
 * the Span Detail pane's header chrome.
 */
const SPAN_TAB_BAR_HEIGHT_PX = 0;

export function Section({
  value,
  title,
  count,
  commentCount,
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
   * How many comments the parts inside this section carry. A section a reader
   * left closed would otherwise hide every comment left in it, and the point of
   * a comment is that the next reader finds it.
   */
  commentCount?: number;
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
   * When set, emits `data-spotlight=<value>` on the accordion item so the drawer's
   * show-once spotlight system can anchor to this section.
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
        // Open state keeps the same bg and `fg.muted` title color as closed — promoting the title
        // color on expand made section labels look heavier than their collapsed siblings.
        _open={{
          borderBottomWidth: "1px",
          borderBottomColor: { base: "gray.200", _dark: "border.muted" },
        }}
        cursor="pointer"
        // Each trigger pins flush with the SpanTabBar (no per-section offset).
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
          <SectionBadges commentCount={commentCount} count={count} empty={empty} />
          {trackPresence ? (
            <SectionPresenceDot traceId={presenceTraceId!} tab={presenceTab!} section={value} />
          ) : null}
        </HStack>
        {/* Fixed 12px indicator to match the header row icon (the default inherits the trigger's
            font size). Explicit `_open` rotation since our `display: flex` override needs it. */}
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
        <SectionContent
          contentPaddingY={tokens.sectionContentY}
          renderChildren={renderChildren}
          trackPresence={trackPresence}
          value={value}
        >
          {children}
        </SectionContent>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}

/** The count, comment count and "empty" markers beside a section's title. */
function SectionBadges({
  commentCount,
  count,
  empty,
}: {
  commentCount?: number;
  count?: number;
  empty?: boolean;
}) {
  return (
    <>
      {count != null && count > 0 && (
        <Badge size="xs" variant="subtle" colorPalette="gray">
          {count}
        </Badge>
      )}
      {commentCount != null && commentCount > 0 && (
        <Badge
          size="xs"
          variant="subtle"
          colorPalette="purple"
          gap={1}
          aria-label={
            commentCount === 1
              ? "1 comment in this section"
              : `${commentCount} comments in this section`
          }
        >
          <Icon as={LuMessageSquare} boxSize={2.5} />
          {commentCount}
        </Badge>
      )}
      {empty && (count == null || count === 0) && (
        <Text textStyle="2xs" color="fg.subtle" fontStyle="italic">
          empty
        </Text>
      )}
    </>
  );
}

/** A section's padded body, wrapped for presence when the drawer is tracking it. */
function SectionContent({
  children,
  contentPaddingY,
  renderChildren,
  trackPresence,
  value,
}: {
  children: ReactNode;
  contentPaddingY: number;
  renderChildren: boolean;
  trackPresence: boolean;
  value: string;
}) {
  const body = renderChildren ? children : null;
  if (!trackPresence) {
    return (
      <Box paddingX={4} paddingY={2} paddingBottom={3}>
        {body}
      </Box>
    );
  }
  return (
    <PresenceSection id={value}>
      <Box paddingX={4} paddingY={contentPaddingY} paddingBottom={contentPaddingY + 1}>
        {body}
      </Box>
    </PresenceSection>
  );
}
