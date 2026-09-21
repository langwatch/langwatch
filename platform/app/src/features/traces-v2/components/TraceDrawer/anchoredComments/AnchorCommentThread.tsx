import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { UserAvatar } from "~/components/UserAvatar";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";

/**
 * What has already been said about one part of the trace, read above the
 * composer that adds to it.
 *
 * Display only. Editing a comment happens where the comment lives beside its
 * turn, so a reader who opens a count here is reading, and the one thing they
 * can do from here is add another.
 */
export function AnchorCommentThread({
  comments,
}: {
  comments: AnnotationByTrace[];
}) {
  if (comments.length === 0) return null;
  return (
    <VStack
      align="stretch"
      gap={2.5}
      marginBottom={3}
      paddingBottom={3}
      borderBottomWidth="1px"
      borderColor="border.muted"
      maxHeight="220px"
      overflowY="auto"
      data-testid="anchor-comment-thread"
    >
      {comments.map((comment) => (
        <HStack key={comment.id} gap={2.5} align="start">
          <UserAvatar
            size="xs"
            background="gray.solid"
            color="white"
            name={comment.user?.name ?? comment.email ?? "?"}
            image={comment.user?.image}
          />
          <VStack align="stretch" gap={0.5} flex={1} minWidth={0}>
            <HStack gap={2}>
              <Text textStyle="2xs" fontWeight="600">
                {comment.user?.name ?? comment.email ?? "anonymous"}
              </Text>
              <Box flex={1} />
              <Text textStyle="2xs" color="fg.subtle">
                {new Date(comment.createdAt).toLocaleDateString()}
              </Text>
            </HStack>
            {comment.comment && (
              <Text textStyle="xs" whiteSpace="pre-wrap">
                {comment.comment}
              </Text>
            )}
          </VStack>
        </HStack>
      ))}
    </VStack>
  );
}
