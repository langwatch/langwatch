import { Heading, HStack, Spacer, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/**
 * Consistent section header form to unify disparate earlier dialects:
 * TITLE + optional QUALIFIER + optional trailing ACTIONS. Owns spacing.
 */
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
      <Heading as="h2" textStyle="sectionTitle" color="fg">
        {title}
      </Heading>
      {qualifier ? (
        <Text
          textStyle="caption"
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
