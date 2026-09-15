import { Heading, HStack, Spacer, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Consistent section header form to unify disparate earlier dialects:
 * TITLE + optional QUALIFIER + optional trailing ACTIONS. Owns spacing.
 */

/** Padding for a home section's card. One value, so titles start level. */
export const HOME_SECTION_PADDING = 4;
/** Gap between a section's header and its content, and between content rows. */
export const HOME_SECTION_GAP = 3;
export function HomeSectionHeader({
  title,
  qualifier,
  children,
}: {
  title: string;
  /** Scopes the title. Rendered as a quiet chip beside it. */
  qualifier?: ReactNode;
  /** Trailing controls, pushed right. */
  children?: ReactNode;
}) {
  return (
    <HStack width="full" gap={2.5} align="center" wrap="wrap">
      <Heading
        as="h2"
        fontWeight="600"
        fontSize="15px"
        letterSpacing="-0.01em"
        color="fg"
        lineHeight="1.3"
      >
        {title}
      </Heading>
      {qualifier ? (
        <Text
          fontFamily="mono"
          fontSize="11px"
          color="fg.muted"
          borderWidth="1px"
          borderColor="border.muted"
          borderRadius="full"
          paddingX={2}
          whiteSpace="nowrap"
        >
          {qualifier}
        </Text>
      ) : null}
      {children ? (
        <>
          <Spacer />
          {children}
        </>
      ) : null}
    </HStack>
  );
}
