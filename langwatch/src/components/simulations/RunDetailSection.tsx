/**
 * Accordion section for the run detail drawer body.
 *
 * Mirrors the Traces V2 drawer section language (uppercase tracked title,
 * count badge, 12px rotating chevron) without importing that feature's
 * Section, which is private to its drawer and carries presence/spotlight/
 * density behaviors that don't apply here.
 */

import { Accordion, Badge, Box, HStack, Icon, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { LuChevronDown } from "react-icons/lu";

export function RunDetailSection({
  value,
  title,
  count,
  isFirst,
  contentPadding = true,
  actions,
  children,
}: {
  value: string;
  title: string;
  count?: number;
  isFirst?: boolean;
  /** Set false for full-bleed content like the results console. */
  contentPadding?: boolean;
  /**
   * Inline controls rendered at the trigger's right edge, before the
   * chevron. The trigger is a <button>, so actions must use span-based
   * controls (role="button"), never nested <button> elements.
   */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Accordion.Item value={value} border="0" data-section={value}>
      <Accordion.ItemTrigger
        width="100%"
        display="flex"
        alignItems="center"
        paddingX={4}
        paddingY={2.5}
        color="fg.muted"
        borderTopWidth={isFirst ? "0" : "1px"}
        borderColor="border.muted"
        transition="background 120ms ease, color 120ms ease"
        _hover={{ bg: "bg.muted", color: "fg" }}
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
        </HStack>
        {actions && (
          <Box
            as="span"
            marginEnd={2}
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </Box>
        )}
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
        <Box
          paddingX={contentPadding ? 4 : 0}
          paddingY={contentPadding ? 3 : 0}
        >
          {children}
        </Box>
      </Accordion.ItemContent>
    </Accordion.Item>
  );
}
