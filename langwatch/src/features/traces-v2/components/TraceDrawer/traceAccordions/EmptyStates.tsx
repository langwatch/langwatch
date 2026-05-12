import { Button, Icon, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { LuCalendarClock } from "react-icons/lu";

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="xs" color="fg.subtle">
      {children}
    </Text>
  );
}

export function EmptyEventsState() {
  return (
    <VStack
      gap={2}
      alignItems="center"
      textAlign="center"
      maxWidth="220px"
      marginX="auto"
      paddingY={3}
    >
      <Icon as={LuCalendarClock} boxSize={5} color="fg.subtle" />
      <VStack gap={1}>
        <Text textStyle="xs" fontWeight="medium" color="fg.muted">
          No events recorded
        </Text>
        <Text textStyle="xs" color="fg.subtle">
          Events capture key moments like tool calls, user feedback, or custom
          milestones.
        </Text>
      </VStack>
      <Button size="xs" variant="outline" asChild>
        <a
          href="https://docs.langwatch.ai/integration/overview"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn more
        </a>
      </Button>
    </VStack>
  );
}
