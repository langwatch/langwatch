import { Accordion, Badge, Box, HStack, Text } from "@chakra-ui/react";
import { type ReactNode, useRef } from "react";
import { PresenceSection } from "~/features/presence/components/PresenceSection";
import { SectionPresenceDot } from "~/features/presence/components/SectionPresenceDot";
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
 * Approximate rendered height of one accordion trigger row (uppercase 2xs
 * label + paddingY=2 + 1px top border). Used to compute the sticky-top
 * offset so triggers stack instead of overlapping. If we restyle the
 * trigger size, bump this in step.
 */
const STICKY_TRIGGER_HEIGHT_PX = 32;

export function Section({
  value,
  title,
  count,
  empty,
  children,
  isFirst,
  stackIndex,
  open,
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
   * Position of this section in its accordion (0-based). Drives the sticky
   * top offset so this section's trigger pins below all earlier sections'
   * triggers as the user scrolls. Pass the iteration index. Falls back to 0
   * when omitted, which collapses the stack into a single sticky line.
   */
  stackIndex?: number;
  /**
   * When provided, defers mounting `children` until the section has been
   * opened at least once. After first open, children stay mounted so toggling
   * collapsed/open is cheap. Omit to fall back to the eager-mount default.
   */
  open?: boolean;
}) {
  const presenceTraceId = useSectionPresenceStore((s) => s.traceId);
  const presenceTab = useSectionPresenceStore((s) => s.tab);
  const trackPresence = !!(presenceTraceId && presenceTab);
  const hasOpenedRef = useRef(open ?? true);
  if (open) hasOpenedRef.current = true;
  const renderChildren = open === undefined || hasOpenedRef.current;
  return (
    <Accordion.Item
      value={value}
      border="0"
      data-section-label={title}
      data-section-count={count ?? ""}
    >
      <Accordion.ItemTrigger
        width="100%"
        paddingX={4}
        paddingY={2}
        // Solid bg under sticky so content scrolling underneath is
        // occluded — without it the title would overlap the content
        // beneath when pinned. `bg.surface` matches the drawer body.
        bg="bg.surface"
        color="fg.muted"
        borderTopWidth={isFirst ? "0" : "1px"}
        borderColor="border.muted"
        transition="background 120ms ease, color 120ms ease"
        _hover={{ bg: "bg.softHover", color: "fg" }}
        _open={{ bg: "bg.softHover", color: "fg" }}
        cursor="pointer"
        // Sticky stack: each trigger pins at a `top` offset that equals
        // its position in the accordion times the trigger height, so as
        // the user scrolls down the open section's body, every earlier
        // trigger comes to rest above it (Notion-style). Inside-Item
        // sticky scopes the stickiness to the Item's height — fine here
        // because the Items are direct children of the same scroll
        // container and their triggers occupy full width.
        position="sticky"
        top={`${(stackIndex ?? 0) * STICKY_TRIGGER_HEIGHT_PX}px`}
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
        <Accordion.ItemIndicator color="inherit" />
      </Accordion.ItemTrigger>
      <Accordion.ItemContent>
        {trackPresence ? (
          <PresenceSection id={value}>
            <Box paddingX={4} paddingY={2} paddingBottom={3}>
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
