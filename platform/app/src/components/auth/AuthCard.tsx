import { Card, Container, Heading, HStack, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { LogoIcon } from "../icons/LogoIcon";

/**
 * The card behind the short, text-only auth states: a password managed
 * elsewhere, a link that cannot be sent, a reset that already worked.
 *
 * The outer width matches the sign-in card so the pages do not jump when a
 * user moves between them, but the body is narrower. Sign-in earns the full
 * width with two-column form rows; a single sentence stretched across the same
 * span is a long line to track back from, and every state here is prose.
 */
export function AuthCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <Container maxW="container.md" paddingTop="calc(40vh - 164px)">
      <Card.Root>
        <Card.Header>
          <HStack gap={4}>
            <LogoIcon width={30.69} height={42} />
            <Heading size="lg" as="h1">
              {title}
            </Heading>
          </HStack>
        </Card.Header>
        <Card.Body>
          <VStack width="full" maxWidth="60ch" align="start" gap={4}>
            {children}
          </VStack>
        </Card.Body>
      </Card.Root>
    </Container>
  );
}
