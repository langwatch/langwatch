import { Box, Card, Heading, HStack, Spacer, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { IdentityChip } from "../../access/IdentityRow";

/**
 * One step of setting single sign-on up.
 *
 * Numbered, and always all five rather than revealed one at a time: an
 * administrator planning an afternoon needs to see what the afternoon
 * contains, and a screen that hides step four until step three is done
 * cannot be planned against. What changes as they go is the tick, not which
 * steps exist.
 */
export function SetupStep({
  number,
  title,
  done = false,
  children,
}: {
  number: number;
  title: string;
  done?: boolean;
  children: ReactNode;
}) {
  return (
    <Card.Root>
      <Card.Body>
        <VStack align="stretch" gap={4}>
          <HStack gap={3}>
            <Box
              width="24px"
              height="24px"
              borderRadius="full"
              display="flex"
              alignItems="center"
              justifyContent="center"
              background={done ? "green.500" : "bg.muted"}
              color={done ? "white" : "fg.muted"}
              fontSize="xs"
              fontWeight="bold"
              flexShrink={0}
            >
              {done ? "✓" : number}
            </Box>
            <Heading size="sm">{title}</Heading>
            <Spacer />
            {done && (
              <IdentityChip label="Done" tone="good" data-testid="step-done" />
            )}
          </HStack>
          {children}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
