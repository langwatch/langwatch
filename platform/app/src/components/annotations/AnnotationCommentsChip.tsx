import { Box, HoverCard, HStack, Portal, Text, VStack } from "@chakra-ui/react";
import { MessageCircle } from "lucide-react";
import { useState } from "react";
import type { AnnotationWithUser } from "./annotationRow";

/**
 * Compact count of the comments left on a row, opening the comments themselves
 * on hover. The cell stays one line wide however much was written, and the
 * reader still gets the text, who wrote it and when without leaving the list.
 *
 * Display-only and self-contained on purpose: the list renders rows for traces
 * that are not open anywhere, so it cannot lean on the trace drawer's stores.
 */
export function AnnotationCommentsChip({
  annotations,
}: {
  annotations: AnnotationWithUser[];
}) {
  const [open, setOpen] = useState(false);
  const commented = annotations.filter((annotation) => annotation.comment);

  if (commented.length === 0) return null;

  return (
    <HoverCard.Root
      open={open}
      openDelay={200}
      closeDelay={150}
      positioning={{ placement: "bottom-start" }}
      onOpenChange={({ open: nextOpen }) => setOpen(nextOpen)}
    >
      <HoverCard.Trigger asChild>
        <HStack
          as="span"
          gap={1}
          paddingX={2}
          paddingY={0.5}
          borderRadius="full"
          borderWidth="1px"
          borderColor="border.muted"
          background="bg.muted"
          cursor="default"
          width="fit-content"
          data-testid="annotation-comments-chip"
          aria-label={`${commented.length} ${
            commented.length === 1 ? "comment" : "comments"
          }`}
        >
          <MessageCircle size={12} />
          <Text textStyle="xs" fontWeight="medium">
            {commented.length}
          </Text>
        </HStack>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            width="360px"
            maxHeight="320px"
            overflowY="auto"
            padding={0}
            borderRadius="lg"
            background="bg.panel"
            boxShadow="lg"
          >
            <VStack align="stretch" gap={0} divideY="1px">
              {commented.map((annotation) => (
                <VStack
                  key={annotation.id}
                  align="start"
                  gap={1}
                  paddingX={3}
                  paddingY={2}
                >
                  <HStack gap={2} width="full">
                    <Text textStyle="xs" fontWeight="semibold">
                      {annotation.user?.name ?? "Unknown user"}
                    </Text>
                    <Box flex={1} />
                    <Text textStyle="2xs" color="fg.subtle">
                      {formatCommentTime(annotation.createdAt)}
                    </Text>
                  </HStack>
                  <Text
                    textStyle="xs"
                    whiteSpace="pre-wrap"
                    wordBreak="break-word"
                  >
                    {annotation.comment}
                  </Text>
                </VStack>
              ))}
            </VStack>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}

function formatCommentTime(createdAt: Date | string | null): string {
  if (!createdAt) return "";
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}
