import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { TraceListItem } from "../../types/trace";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatTokens,
  STATUS_COLORS,
} from "../../utils/formatters";

interface TracePeekProps {
  trace: TraceListItem;
  anchorRect: DOMRect;
  onOpenDrawer: () => void;
  onDismiss: () => void;
}

export const TracePeek: React.FC<TracePeekProps> = ({
  trace,
  anchorRect,
  onOpenDrawer,
  onDismiss,
}) => {
  const peekRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onDismiss]);

  const statusColor = STATUS_COLORS[trace.status] as string;

  return (
    <Box
      ref={peekRef}
      position="fixed"
      top={`${anchorRect.bottom + 4}px`}
      left={`${anchorRect.left}px`}
      width={`${Math.min(anchorRect.width, 500)}px`}
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="lg"
      shadow="lg"
      zIndex={40}
      overflow="hidden"
      onMouseLeave={onDismiss}
      css={{
        animation: "tracePeekFadeIn 0.15s ease-out",
        "@keyframes tracePeekFadeIn": {
          from: { opacity: 0, transform: "translateY(-4px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
      }}
    >
      <VStack align="stretch" gap={0}>
        {/* Header */}
        <HStack padding={3} gap={2}>
          <Circle size="8px" bg={statusColor} flexShrink={0} />
          <Text textStyle="sm" fontWeight="semibold" truncate flex={1}>
            {trace.name}
          </Text>
        </HStack>

        {/* Metrics row */}
        <HStack paddingX={3} paddingBottom={2} gap={3} flexWrap="wrap">
          <MetricChip label="Duration" value={formatDuration(trace.durationMs)} />
          {trace.totalCost > 0 && (
            <MetricChip label="Cost" value={formatCost(trace.totalCost)} />
          )}
          {trace.totalTokens > 0 && (
            <MetricChip label="Tokens" value={formatTokens(trace.totalTokens)} />
          )}
          {trace.models.length > 0 && (
            <MetricChip label="Model" value={abbreviateModel(trace.models[0]!)} />
          )}
          <MetricChip label="Spans" value={String(trace.spanCount)} />
        </HStack>

        <Box height="1px" bg="border.muted" />

        {/* I/O Preview */}
        {(trace.input || trace.output) && (
          <VStack align="stretch" gap={1} padding={3}>
            {trace.input && (
              <Box>
                <Text textStyle="xs" fontWeight="medium" color="fg.muted" marginBottom={0.5}>
                  Input
                </Text>
                <Text
                  textStyle="xs"
                  color="fg"
                  fontFamily="mono"
                  lineClamp={2}
                  whiteSpace="pre-wrap"
                  wordBreak="break-word"
                >
                  {trace.input}
                </Text>
              </Box>
            )}
            {trace.output && (
              <Box>
                <Text textStyle="xs" fontWeight="medium" color="fg.muted" marginBottom={0.5}>
                  Output
                </Text>
                <Text
                  textStyle="xs"
                  color="fg"
                  fontFamily="mono"
                  lineClamp={2}
                  whiteSpace="pre-wrap"
                  wordBreak="break-word"
                >
                  {trace.output}
                </Text>
              </Box>
            )}
          </VStack>
        )}

        {/* Error */}
        {trace.error && (
          <Box paddingX={3} paddingBottom={2}>
            <Box padding={2} borderRadius="sm" bg="red.subtle">
              <Text textStyle="xs" color="red.fg" lineClamp={2}>
                {trace.error}
              </Text>
            </Box>
          </Box>
        )}

        <Box height="1px" bg="border.muted" />

        {/* Footer */}
        <HStack padding={2} justify="space-between">
          <Text textStyle="xs" color="fg.subtle">
            {trace.serviceName}
          </Text>
          <Button size="xs" variant="ghost" onClick={onOpenDrawer}>
            Open in drawer
            <Icon boxSize={3}>
              <ExternalLink />
            </Icon>
          </Button>
        </HStack>
      </VStack>
    </Box>
  );
};

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={1}>
      <Text textStyle="xs" color="fg.subtle">
        {label}:
      </Text>
      <Text textStyle="xs" color="fg" fontFamily="mono" fontWeight="medium">
        {value}
      </Text>
    </HStack>
  );
}

/**
 * Hook that manages TracePeek state: hover delay, anchor rect, and dismissal.
 */
export function useTracePeek() {
  const [peekTrace, setPeekTrace] = useState<TraceListItem | null>(null);
  const [peekRect, setPeekRect] = useState<DOMRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(
    (trace: TraceListItem, rect: DOMRect) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setPeekTrace(trace);
        setPeekRect(rect);
      }, 1000);
    },
    [],
  );

  const handleMouseLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    setPeekTrace(null);
    setPeekRect(null);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return {
    peekTrace,
    peekRect,
    handleMouseEnter,
    handleMouseLeave,
    dismiss,
  };
}
