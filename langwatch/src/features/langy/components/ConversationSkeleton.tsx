import { Box, Skeleton, VStack } from "@chakra-ui/react";

import { useReducedMotion } from "~/hooks/useReducedMotion";

/**
 * How many placeholder turns are worth drawing. The column only shows a few
 * before the composer, and a long conversation scrolls to its end anyway, so
 * more rows would be shimmer nobody sees.
 */
const MAX_SKELETON_MESSAGES = 4;

export function skeletonMessageCount(messageCount: number | null): number {
  if (messageCount === null) return 2;
  return Math.min(Math.max(messageCount, 1), MAX_SKELETON_MESSAGES);
}

/**
 * The shape of a conversation that has not arrived yet.
 *
 * Restoring is not the same as starting fresh: the panel remembered WHICH
 * conversation was open, so it knows before the messages land that there is
 * one. Rendering the empty state's "How can I help?" in that window painted an
 * invitation over a conversation the reader had already had, then swapped it
 * out a beat later — Langy looking like it had forgotten them. This holds the
 * column instead, in roughly the shape the messages will take: a narrow
 * question on the right, a wider answer on the left.
 *
 * `count` comes from the recents list's message count, so the placeholder
 * occupies about the space the real thread will and the card does not resize
 * underneath it. Decorative — `aria-hidden`, with the live region that
 * announces the loaded conversation left to do the talking.
 */
export function ConversationSkeleton({
  count,
  dense = false,
}: {
  count: number;
  dense?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const gap = dense ? "12px" : "16px";

  return (
    <VStack align="stretch" gap={gap} aria-hidden data-testid="langy-conversation-skeleton">
      {Array.from({ length: count }, (_, index) => {
        const isQuestion = index % 2 === 0;
        return isQuestion ? (
          <Box key={index} alignSelf="flex-end" maxWidth="85%" width="55%">
            <Skeleton
              height="34px"
              borderRadius="15px"
              variant={reduceMotion ? "none" : "pulse"}
            />
          </Box>
        ) : (
          <VStack key={index} align="stretch" gap="8px" width="100%">
            <Skeleton
              height="12px"
              width="92%"
              borderRadius="6px"
              variant={reduceMotion ? "none" : "pulse"}
            />
            <Skeleton
              height="12px"
              width="78%"
              borderRadius="6px"
              variant={reduceMotion ? "none" : "pulse"}
            />
            <Skeleton
              height="12px"
              width="45%"
              borderRadius="6px"
              variant={reduceMotion ? "none" : "pulse"}
            />
          </VStack>
        );
      })}
    </VStack>
  );
}
