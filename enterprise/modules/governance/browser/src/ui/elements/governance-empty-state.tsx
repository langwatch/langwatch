/**
 * Empty state component with customizable copy and optional action button; shared shape
 * from Langy with per-caller text (one shape, many voices).
 */

import {
  Box,
  Button,
  type ButtonProps,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ComponentType, PropsWithChildren, ReactNode } from "react";

import { PageLayout } from "@langwatch/design-system/page-layout";

/** Card shape + surface, copied from the Langy briefing's `CARD` token. */
const CARD = {
  radius: "14px",
  borderWidth: "1px",
  border: "border.muted",
  bg: "bg.surface",
} as const;

/** Structural, so a lucide glyph and any other icon library both satisfy it. */
export type GovernanceEmptyStateIcon = ComponentType<{
  size?: string | number;
}>;

/**
 * Action button for empty states with primary (create) and secondary (view) emphasis.
 */
export function GovernanceEmptyStateAction({
  children,
  emphasis = "primary",
  ...props
}: PropsWithChildren<
  ButtonProps & {
    emphasis?: "primary" | "secondary";
  }
>) {
  if (emphasis === "primary") {
    return (
      <PageLayout.HeaderButton {...props}>{children}</PageLayout.HeaderButton>
    );
  }

  return (
    <Button size="sm" variant="ghost" {...props}>
      {children}
    </Button>
  );
}

export function GovernanceEmptyState({
  icon: Icon,
  headline,
  description,
  action,
  secondaryAction,
  testId,
}: {
  icon: GovernanceEmptyStateIcon;
  /** The state, not a fault. "No agents registered yet", not "No agents". */
  headline: string;
  /** One sentence saying why it is empty and what fills it. Two if the second earns itself. */
  description: string;
  /** The move that changes the state. Omit only when the reader has none. */
  action?: ReactNode;
  /** A second, quieter way out. At most one: three choices is a menu. */
  secondaryAction?: ReactNode;
  testId?: string;
}) {
  return (
    <VStack
      data-testid={testId}
      align="center"
      gap={0}
      width="full"
      // A hairline and a surface, never a dashed outline. Dashes read as a
      // drop target or a component that failed to arrive; this is neither.
      borderWidth={CARD.borderWidth}
      borderColor={CARD.border}
      borderRadius={CARD.radius}
      background={CARD.bg}
      paddingX={6}
      paddingY={10}
      textAlign="center"
    >
      {/* Neutral, not orange. The glyph is here to give the block a centre of
          gravity, not to be the loudest thing on a page that already has a
          primary action two lines below it. */}
      <Box
        color="fg.subtle"
        display="grid"
        placeItems="center"
        width="44px"
        height="44px"
        borderRadius="full"
        borderWidth="1px"
        borderColor="border.muted"
        background="bg.muted"
        marginBottom={4}
      >
        <Icon size={20} />
      </Box>
      <Text
        fontFamily="heading"
        fontSize="20px"
        fontWeight="500"
        letterSpacing="-0.02em"
        color="fg"
      >
        {headline}
      </Text>
      <Text
        textStyle="sm"
        color="fg.muted"
        lineHeight="1.5"
        textWrap="balance"
        // Wide enough for two lines of a real sentence, narrow enough that the
        // text stays a paragraph rather than spanning a widescreen table.
        maxWidth="420px"
        marginTop={2}
      >
        {description}
      </Text>
      {(action ?? secondaryAction) ? (
        <HStack gap={2} marginTop={5}>
          {action}
          {secondaryAction}
        </HStack>
      ) : null}
    </VStack>
  );
}
