import { Box, HStack, HoverCard, Portal, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { useState } from "react";
import { annotationAnchorLabel, type AnnotationWithUser } from "./annotation-row";

export function AnnotationHoverChip({
  annotations,
  traceId,
  icon,
  testId,
  count,
  countLabel,
  textOf,
}: {
  annotations: AnnotationWithUser[];
  traceId: string;
  icon: ReactNode;
  testId: string;
  count?: number;
  countLabel: (count: number) => string;
  textOf: (annotation: AnnotationWithUser) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const written = annotations.filter((annotation) => textOf(annotation));
  const shownCount = count ?? written.length;

  if (written.length === 0) {
    return null;
  }

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
          data-testid={testId}
          aria-label={countLabel(shownCount)}
        >
          {icon}
          <Text textStyle="xs" fontWeight="medium">
            {shownCount}
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
              {written.map((annotation) => (
                <AnnotationHoverEntry
                  key={annotation.id}
                  annotation={annotation}
                  traceId={traceId}
                  text={textOf(annotation) ?? ""}
                />
              ))}
            </VStack>
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
}

function AnnotationHoverEntry({
  annotation,
  traceId,
  text,
}: {
  annotation: AnnotationWithUser;
  traceId: string;
  text: string;
}) {
  const anchorLabel = annotationAnchorLabel({ annotation, traceId });

  return (
    <VStack align="start" gap={1} paddingX={3} paddingY={2}>
      <HStack gap={2} width="full">
        <Text textStyle="xs" fontWeight="semibold">
          {annotation.user?.name ?? "Unknown user"}
        </Text>
        <Box flex={1} />
        <Text textStyle="2xs" color="fg.subtle">
          {formatAnnotationTime(annotation.createdAt)}
        </Text>
      </HStack>
      {anchorLabel && (
        <Text textStyle="2xs" color="fg.muted">
          {anchorLabel}
        </Text>
      )}
      <Text textStyle="xs" whiteSpace="pre-wrap" wordBreak="break-word" lineClamp={6}>
        {text}
      </Text>
    </VStack>
  );
}

function formatAnnotationTime(createdAt: Date | string | null): string {
  if (!createdAt) {
    return "";
  }
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}
