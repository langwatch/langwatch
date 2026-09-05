import { Box, Skeleton, VStack } from "@chakra-ui/react";

import { useReducedMotion } from "../../../../behavior/use-reduced-motion";

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
 */
export function ConversationSkeleton({ count, dense = false }: { count: number; dense?: boolean }) {
  const reduceMotion = useReducedMotion();
  const gap = dense ? "12px" : "16px";

  return (
    <VStack align="stretch" gap={gap} aria-hidden data-testid="langy-conversation-skeleton">
      {Array.from({ length: count }, (_, index) => {
        const isQuestion = index % 2 === 0;
        return isQuestion ? (
          <Box key={index} alignSelf="flex-end" maxWidth="85%" width="55%">
            <Skeleton height="34px" borderRadius="15px" variant={reduceMotion ? "none" : "pulse"} />
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
