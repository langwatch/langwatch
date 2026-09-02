/**
 * LeaderboardStep — numbered section wrapper for the leaderboard drawer.
 *
 * The drawer answers three questions in a fixed order: what should I ship,
 * can I believe it, and what do I do about it. Numbering them makes that
 * order legible instead of leaving a reader to infer it from a stack of
 * charts, and lets someone stop after step 1 with a defensible answer.
 */
import { Box, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuInfo } from "react-icons/lu";

import { Tooltip } from "@langwatch/design-system/tooltip";

export type LeaderboardStepProps = {
  index: number;
  title: string;
  /** One line on what this step settles, in the reader's terms. */
  subtitle: string;
  /**
   * The longer "what am I actually looking at" answer, behind an info icon.
   *
   * Separate from `subtitle` on purpose. The subtitle has to stay one short
   * line or the three steps stop scanning as a sequence, but a reader
   * meeting a Bradley-Terry score for the first time needs more than a line
   * — and putting that in the header would bury the answer under a
   * statistics lesson for everyone who already knows.
   */
  help?: React.ReactNode;
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
  help,
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
          <HStack gap={1.5} align="center">
            <Text fontSize="sm" fontWeight="bold">
              {title}
            </Text>
            {help ? (
              <Tooltip
                content={help}
                positioning={{ placement: "bottom-start" }}
                contentProps={{ maxWidth: "320px" }}
              >
                {/* tabIndex so the explanation is reachable without a
                    pointer — the readers most likely to need it are the
                    least likely to go hunting for a hover target. */}
                <Box
                  as="span"
                  tabIndex={0}
                  color="fg.subtle"
                  display="inline-flex"
                  cursor="help"
                  aria-label={`What does "${title}" mean?`}
                >
                  <Icon as={LuInfo} boxSize="13px" />
                </Box>
              </Tooltip>
            ) : null}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {subtitle}
          </Text>
        </VStack>
      </HStack>
      {children}
    </Box>
  );
}
