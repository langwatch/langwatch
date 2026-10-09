/**
 * The small pieces an automation card is drawn from, in the Automations
 * list's own vocabulary: the state as the list's dot and word, and the
 * delivery as its action name over a muted destination.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import type { LangyAutomationDestination } from "../../logic/langyAutomationSummary";

/** Mirrors the list's firing status: a dot only while it runs. */
export function AutomationState({ active }: { active: boolean }) {
  return (
    <HStack
      as="span"
      gap={1.5}
      flexShrink={0}
      data-testid="langy-automation-state"
    >
      {active ? (
        <Box width="8px" height="8px" borderRadius="full" bg="green.solid" />
      ) : null}
      <Text as="span" textStyle="sm" color={active ? "fg" : "fg.muted"}>
        {active ? "Active" : "Paused"}
      </Text>
    </HStack>
  );
}

/** One label and value line of the card, like the view drawer's fields. */
export function AutomationField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <HStack align="start" gap={3} minWidth={0}>
      <Text textStyle="xs" color="fg.muted" width="64px" flexShrink={0}>
        {label}
      </Text>
      <Box flex={1} minWidth={0}>
        {children}
      </Box>
    </HStack>
  );
}

/** The list's Delivery cell: action name, destination muted beneath. */
export function AutomationDestinations({
  destinations,
}: {
  destinations: LangyAutomationDestination[];
}) {
  return (
    <VStack
      align="start"
      gap={1}
      minWidth={0}
      data-testid="langy-automation-destinations"
    >
      {destinations.map((destination) => (
        <VStack
          key={`${destination.channel}:${destination.label}`}
          align="start"
          gap={0}
          minWidth={0}
        >
          <Text textStyle="sm" fontWeight="medium">
            {destination.label}
          </Text>
          {destination.detail ? (
            <Text textStyle="xs" color="fg.muted" overflowWrap="anywhere">
              {destination.detail}
            </Text>
          ) : null}
        </VStack>
      ))}
    </VStack>
  );
}
