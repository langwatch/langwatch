import { Box, Heading, HStack, Spacer, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";

import { SampleMark } from "./sampleMark";

/**
 * Card shell for every panel on the Costs page: a title, the panel, and
 * nothing else. The page deliberately carries no explanatory prose — a
 * heading and the figures beneath it have to do the work.
 *
 * `sample` marks a panel drawn from `sampleSeries` rather than from a real
 * read. It is a badge rather than a sentence so it stays out of the way, and
 * it is never optional on a placeholder panel the reader could mistake for a
 * measured one: unlabelled invented money is indistinguishable from the
 * organization's own. `SampleMark` decides when that mistake is possible —
 * while the page-wide banner is up it is not, and the mark stands down.
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
      data-testid="cost-panel"
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
        <SampleMark shown={sample} />
        <Spacer />
        {action}
      </HStack>
      <Box>{children}</Box>
    </VStack>
  );
}
