import { Box, EmptyState, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * A band that holds nothing yet: what the thing is, and the one offer to
 * start it.
 *
 * Chakra's own `EmptyState` rather than a hand-rolled panel, so this reads the
 * way every other empty surface in the product reads. What is local is the
 * restraint: a contained panel on the band's ground, the glyph in muted ink,
 * one line of explanation, and the call to action at OUTLINE weight.
 *
 * The weight matters. A solid orange button in an empty state is the loudest
 * thing in a page of quiet rows, and a page with three of them — no passkey,
 * no two-step verification, no password — reads as three alarms rather than
 * three offers. The primary weight is for a decision somebody has already
 * started, not for the invitation to start one.
 */
export function SettingsEmptyState({
  icon,
  title,
  description,
  action,
  testId,
}: {
  /** A 20px lucide glyph. Muted, never in colour. */
  icon: ReactNode;
  title: string;
  /** One line. The band's own description already said the general case. */
  description: string;
  action: ReactNode;
  testId?: string;
}) {
  return (
    <EmptyState.Root
      size="sm"
      width="full"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="10px"
      paddingY={6}
      paddingX={5}
      data-testid={testId}
    >
      <EmptyState.Content>
        <EmptyState.Indicator color="fg.muted">{icon}</EmptyState.Indicator>
        <VStack gap={1} textAlign="center">
          <EmptyState.Title fontSize="sm" fontWeight={600}>
            {title}
          </EmptyState.Title>
          <EmptyState.Description
            fontSize="sm"
            color="fg.muted"
            maxWidth="46ch"
          >
            {description}
          </EmptyState.Description>
        </VStack>
        <Box paddingTop={1}>{action}</Box>
      </EmptyState.Content>
    </EmptyState.Root>
  );
}
