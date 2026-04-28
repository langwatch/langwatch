import {
  Box,
  Circle,
  HoverCard,
  HStack,
  Icon,
  Portal,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Eye } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  abbreviateModel,
  formatCost,
  formatDuration,
  formatTokens,
  STATUS_COLORS,
} from "../utils/formatters";

interface TraceIdPeekProps {
  traceId: string;
}

/**
 * Reusable hover-peek for trace IDs. Renders a small icon that, on hover,
 * shows a compact trace summary popover. On click, opens the trace drawer.
 *
 * Drop this next to any trace ID display across the platform.
 */
export const TraceIdPeek: React.FC<TraceIdPeekProps> = ({ traceId }) => {
  const { openDrawer } = useDrawer();
  const [hasHovered, setHasHovered] = useState(false);
  const [open, setOpen] = useState(false);

  const handleOpenDrawer = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    openDrawer("traceV2Details", { traceId });
  };

  return (
    <HoverCard.Root
      open={open}
      openDelay={400}
      closeDelay={200}
      positioning={{ placement: "bottom-start" }}
      onOpenChange={({ open: nextOpen }) => {
        setOpen(nextOpen);
        if (nextOpen) setHasHovered(true);
      }}
    >
      <HoverCard.Trigger asChild>
        <Box
          as="button"
          onClick={handleOpenDrawer}
          display="inline-flex"
          alignItems="center"
          justifyContent="center"
          flexShrink={0}
          width="16px"
          height="16px"
          borderRadius="sm"
          color="fg.subtle/40"
          _hover={{ color: "fg.muted" }}
          transition="color 0.1s"
        >
          <Icon boxSize="11px">
            <Eye />
          </Icon>
        </Box>
      </HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            width="320px"
            padding={0}
            borderRadius="lg"
            background="bg.panel/95"
            backdropFilter="blur(8px)"
            boxShadow="lg"
          >
            {hasHovered && <PeekPopoverContent traceId={traceId} />}
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
};

function PeekPopoverContent({ traceId }: { traceId: string }) {
  const { project } = useOrganizationTeamProject();

  const { data: trace, isLoading } = api.tracesV2.header.useQuery(
    { projectId: project?.id ?? "", traceId },
    { enabled: !!project?.id, staleTime: 300_000 },
  );

  if (isLoading || !trace) {
    return (
      <VStack align="stretch" gap={2} padding={3}>
        <Skeleton height="16px" width="60%" borderRadius="sm" />
        <Skeleton height="12px" width="80%" borderRadius="sm" />
        <Skeleton height="12px" width="40%" borderRadius="sm" />
      </VStack>
    );
  }

  const statusColor = STATUS_COLORS[trace.status] as string;

  return (
    <VStack align="stretch" gap={0}>
      {/* Header */}
      <HStack padding={3} gap={2}>
        <Circle size="8px" bg={statusColor} flexShrink={0} />
        <Text textStyle="sm" fontWeight="semibold" truncate flex={1}>
          {trace.rootSpanName ?? trace.name}
        </Text>
      </HStack>

      {/* Metrics */}
      <HStack paddingX={3} paddingBottom={2} gap={3} flexWrap="wrap">
        <PopoverMetric
          label="Duration"
          value={formatDuration(trace.durationMs)}
        />
        {(trace.totalCost ?? 0) > 0 && (
          <PopoverMetric
            label="Cost"
            value={formatCost(trace.totalCost ?? 0)}
          />
        )}
        {trace.totalTokens > 0 && (
          <PopoverMetric
            label="Tokens"
            value={formatTokens(trace.totalTokens)}
          />
        )}
        {trace.models.length > 0 && (
          <PopoverMetric
            label="Model"
            value={abbreviateModel(trace.models[0]!)}
          />
        )}
        <PopoverMetric label="Spans" value={String(trace.spanCount)} />
      </HStack>

      <Box height="1px" bg="border.muted" />

      {/* I/O Preview */}
      {(trace.input || trace.output) && (
        <VStack align="stretch" gap={1} padding={3}>
          {trace.input && (
            <Box>
              <Text
                textStyle="2xs"
                fontWeight="medium"
                color="fg.muted"
                marginBottom={0.5}
              >
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
              <Text
                textStyle="2xs"
                fontWeight="medium"
                color="fg.muted"
                marginBottom={0.5}
              >
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
      <HStack padding={2} paddingX={3} justify="space-between">
        <Text textStyle="2xs" color="fg.subtle" fontFamily="mono">
          {traceId.slice(0, 16)}...
        </Text>
        <Text textStyle="2xs" color="fg.subtle">
          {trace.serviceName}
        </Text>
      </HStack>
    </VStack>
  );
}

function PopoverMetric({ label, value }: { label: string; value: string }) {
  return (
    <HStack gap={1}>
      <Text textStyle="2xs" color="fg.subtle">
        {label}:
      </Text>
      <Text textStyle="2xs" color="fg" fontFamily="mono" fontWeight="medium">
        {value}
      </Text>
    </HStack>
  );
}
