import { Badge, Box, Heading, HStack, Spacer, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * Card shell for every panel on the Costs page: a title, the panel, and
 * nothing else. The page deliberately carries no explanatory prose — a
 * heading and the figures beneath it have to do the work.
 *
 * `sample` marks a panel drawn from `sampleSeries` rather than from a real
 * read. It is a badge rather than a sentence so it stays out of the way, but
 * it is never optional on a placeholder panel: unlabelled invented money is
 * indistinguishable from the organization's own.
 */
export function CostPanel({
  title,
  sample = false,
  action,
  children,
}: {
  title: string;
  sample?: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <VStack
      align="stretch"
      gap={3}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      backgroundColor="bg.panel"
      padding={4}
    >
      <HStack gap={2}>
        <Heading size="sm">{title}</Heading>
        {sample && (
          <Badge size="xs" variant="subtle" colorPalette="gray">
            sample
          </Badge>
        )}
        <Spacer />
        {action}
      </HStack>
      <Box>{children}</Box>
    </VStack>
  );
}
