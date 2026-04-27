import { useState } from "react";
import { Box, Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { LuChevronDown, LuChevronRight, LuCircleX } from "react-icons/lu";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { formatDuration } from "../../utils/formatters";

interface ExceptionsSectionProps {
  spans: SpanTreeNode[];
  onSelectSpan?: (spanId: string) => void;
  showSpanOrigin?: boolean;
}

interface ExceptionEntry {
  span: SpanTreeNode;
  type: string;
  message: string;
}

function extractExceptions(spans: SpanTreeNode[]): ExceptionEntry[] {
  const exceptions: ExceptionEntry[] = [];

  for (const span of spans) {
    if (span.status === "error") {
      exceptions.push({
        span,
        type: "Error",
        message: "Error in span",
      });
    }
  }

  return exceptions;
}

export function ExceptionsSection({
  spans,
  onSelectSpan,
  showSpanOrigin = true,
}: ExceptionsSectionProps) {
  const exceptions = extractExceptions(spans);

  if (exceptions.length === 0) return null;

  return (
    <VStack align="stretch" gap={3}>
      <Text textStyle="xs" color="fg.subtle" marginBottom={1}>
        {exceptions.length} exception{exceptions.length !== 1 ? "s" : ""}
      </Text>
      {exceptions.map((entry, i) => (
        <Box
          key={`${entry.span.spanId}-${i}`}
          borderLeftWidth="2px"
          borderColor="red.muted"
          paddingLeft={3}
          paddingY={1}
        >
          <HStack gap={2} marginBottom={1}>
            <Icon as={LuCircleX} boxSize={3.5} color="red.fg" flexShrink={0} />
            <Text textStyle="xs" fontWeight="semibold" color="red.fg" fontFamily="mono">
              {entry.type}
            </Text>
          </HStack>
          <Text textStyle="xs" color="red.fg" fontFamily="mono" marginBottom={1}>
            {entry.message}
          </Text>
          {showSpanOrigin && (
            <HStack gap={1} marginTop={1}>
              <Text textStyle="xs" color="fg.subtle">from</Text>
              <Button
                size="xs"
                variant="plain"
                color="blue.fg"
                padding={0}
                height="auto"
                fontFamily="mono"
                onClick={() => onSelectSpan?.(entry.span.spanId)}
              >
                {entry.span.name}
              </Button>
            </HStack>
          )}
        </Box>
      ))}
    </VStack>
  );
}

export function hasExceptions(spans: SpanTreeNode[]): boolean {
  return spans.some((s) => s.status === "error");
}
