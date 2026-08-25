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
    <Card.Root borderRadius="xl">
      <Card.Body>
        <VStack align="stretch" gap={4}>
          <HStack gap={2.5}>
            <Box
              width="22px"
              height="22px"
              borderRadius="full"
              display="flex"
              alignItems="center"
              justifyContent="center"
              background={done ? "green.solid" : "bg.muted"}
              borderWidth={done ? 0 : "1px"}
              borderColor="border.muted"
              color={done ? "white" : "fg.muted"}
              fontSize="11px"
              fontWeight="semibold"
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
