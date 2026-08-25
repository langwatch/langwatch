import { Card, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { IdentityChip } from "~/components/access/IdentityRow";

/**
 * One of the two things an administrator came to check, in a shape both of
 * them share.
 *
 * The overview answers two questions side by side — how people sign in, and
 * how their accounts arrive — and they only read as one answer if they are
 * drawn the same way: a name, a chip saying where it stands, the facts
 * underneath, and whatever the reader can do about it along the bottom. A
 * card that invented its own arrangement would turn one page into two.
 */
export function OverviewCard({
  title,
  chip,
  children,
  actions,
  "data-testid": testId,
}: {
  title: string;
  /** Where this half of authentication stands. Never a raw state name. */
  chip?: {
    label: string;
    tone: "neutral" | "good" | "warning" | "bad";
    title: string;
  };
  children: ReactNode;
  actions?: ReactNode;
  "data-testid"?: string;
}) {
  return (
    <Card.Root width="full" height="full" data-testid={testId}>
      <Card.Body>
        <VStack align="stretch" gap={4} height="full">
          <HStack width="full" gap={3}>
            <Heading size="sm">{title}</Heading>
            <Spacer />
            {chip && (
              <IdentityChip
                label={chip.label}
                tone={chip.tone}
                title={chip.title}
              />
            )}
          </HStack>

          <VStack align="stretch" gap={3}>
            {children}
          </VStack>

          {actions && (
            <>
              <Spacer />
              <HStack gap={2} flexWrap="wrap" paddingTop={1}>
                {actions}
              </HStack>
            </>
          )}
        </VStack>
      </Card.Body>
    </Card.Root>
  );
}

/** One labelled fact inside a card. */
export function OverviewDetail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <VStack align="start" gap={1}>
      <Text fontSize="xs" color="fg.muted" textTransform="uppercase">
        {label}
      </Text>
      {children}
    </VStack>
  );
}
