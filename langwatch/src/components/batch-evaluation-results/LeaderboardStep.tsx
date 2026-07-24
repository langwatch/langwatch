/**
 * LeaderboardStep — numbered section wrapper for the leaderboard drawer.
 *
 * The drawer answers three questions in a fixed order: what should I ship,
 * can I believe it, and what do I do about it. Numbering them makes that
 * order legible instead of leaving a reader to infer it from a stack of
 * charts, and lets someone stop after step 1 with a defensible answer.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";

export type LeaderboardStepProps = {
  index: number;
  title: string;
  /** One line on what this step settles, in the reader's terms. */
  subtitle: string;
  /**
   * Draws attention only when this step has something wrong with it.
   * Reserved for genuine problems — a step marked every time teaches the
   * reader to stop seeing it.
   */
  hasProblem?: boolean;
  children: React.ReactNode;
};

export function LeaderboardStep({
  index,
  title,
  subtitle,
  hasProblem = false,
  children,
}: LeaderboardStepProps) {
  return (
    <Box
      borderWidth="1px"
      borderColor={hasProblem ? "orange.emphasized" : "border.muted"}
      borderRadius="md"
      padding={4}
      bg="bg.subtle"
    >
      <HStack align="start" gap={3} marginBottom={3}>
        <Box
          minWidth="22px"
          height="22px"
          borderRadius="full"
          bg={hasProblem ? "orange.emphasized" : "border.emphasized"}
          color="bg"
          display="flex"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
        >
          <Text fontSize="2xs" fontWeight="bold">
            {index}
          </Text>
        </Box>
        <VStack align="start" gap={0}>
          <Text fontSize="sm" fontWeight="bold">
            {title}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {subtitle}
          </Text>
        </VStack>
      </HStack>
      {children}
    </Box>
  );
}
