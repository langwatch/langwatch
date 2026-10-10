import { Box, Card, Heading, HStack, Text } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

/** One checkup section composed from the shared outline card. */
export function CheckupSection({
  icon,
  title,
  description,
  action,
  testId,
  children,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Card.Root as="section" variant="outline" width="full" data-testid={testId}>
      <Card.Header>
        <HStack justify="space-between" align="start" wrap="wrap" gap={3}>
          <HStack minWidth={0} gap={2}>
            {icon ? (
              <Box color="fg.muted" flexShrink={0}>
                {icon}
              </Box>
            ) : null}
            <Heading size="sm" overflowWrap="anywhere">
              {title}
            </Heading>
          </HStack>
          {action}
        </HStack>
        {description ? (
          <Text textStyle="sm" color="fg.muted">
            {description}
          </Text>
        ) : null}
      </Card.Header>
      <Card.Body gap={5}>{children}</Card.Body>
    </Card.Root>
  );
}

/** A nested checkup item using the shared subtle card. */
export function CheckupSectionRow({ testId, children }: { testId?: string; children: ReactNode }) {
  return (
    <Card.Root variant="subtle" width="full" data-testid={testId}>
      <Card.Body>
        <HStack gap={3} align="start" minWidth={0} wrap="wrap">
          {children}
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}
