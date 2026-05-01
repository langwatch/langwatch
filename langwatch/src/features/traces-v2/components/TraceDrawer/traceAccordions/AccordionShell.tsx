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

export function Section({
  value,
  title,
  count,
  empty,
  children,
  isFirst,
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
        bg="transparent"
        color="fg.muted"
        borderTopWidth={isFirst ? "0" : "1px"}
        borderColor="border.muted"
        transition="background 120ms ease, color 120ms ease"
        _hover={{ bg: "bg.softHover", color: "fg" }}
        _open={{ bg: "bg.softHover", color: "fg" }}
        cursor="pointer"
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
