import { Card, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

export function PolicySection({
  title,
  hint,
  badge,
  actions,
  children,
  "data-testid": testId,
}: {
  title: string;
  hint: string;
  badge?: ReactNode;
  actions: ReactNode;
  children: ReactNode;
  "data-testid": string;
}) {
  return (
    <Card.Root width="full" bg="bg.card" borderColor="border.card" data-testid={testId}>
      <Card.Body paddingX={3} paddingY={2}>
        <VStack align="stretch" gap={1.5}>
          <VStack align="stretch" gap={0}>
            <HStack justify="space-between" gap={2}>
              <Text as="h3" fontSize="xs" fontWeight="semibold" lineHeight="short">
                {title}
              </Text>
              {badge}
            </HStack>
            <Text fontSize="xs" color="fg.muted" lineHeight="short">
              {hint}
            </Text>
          </VStack>
          {children}
          {actions}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}
