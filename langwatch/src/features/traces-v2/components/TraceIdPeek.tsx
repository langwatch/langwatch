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
import { type ReactNode, useState } from "react";
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

interface TracePreviewHoverCardProps {
  traceId: string;
  children: ReactNode;
  /**
   * Defaults to "bottom-start" — sits below the trigger and aligns to
   * its leading edge. Override when the trigger is on the far right of
   * a row and a bottom-end placement reads better.
   */
  placement?:
    | "top"
    | "top-start"
    | "top-end"
    | "bottom"
    | "bottom-start"
    | "bottom-end";
}

/**
 * Hover wrapper that surfaces a compact v2 trace summary popover on any
 * trigger you put inside it. Use it to add a hover-peek to any element
 * already mounted next to a trace — buttons, links, badges — without
 * needing a standalone trigger like the eye icon.
 */
export const TracePreviewHoverCard: React.FC<TracePreviewHoverCardProps> = ({
  traceId,
  children,
  placement = "bottom-start",
}) => {
  const [hasHovered, setHasHovered] = useState(false);
  const [open, setOpen] = useState(false);

  return (
    <HoverCard.Root
      open={open}
      openDelay={400}
      closeDelay={200}
      positioning={{ placement }}
      onOpenChange={({ open: nextOpen }) => {
        setOpen(nextOpen);
        if (nextOpen) setHasHovered(true);
      }}
    >
      <HoverCard.Trigger asChild>{children}</HoverCard.Trigger>
      <Portal>
        <HoverCard.Positioner>
          <HoverCard.Content
            width="320px"
            padding={0}
            borderRadius="lg"
            background="bg.panel"
            boxShadow="lg"
          >
            {hasHovered && <PeekPopoverContent traceId={traceId} />}
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
};

interface TraceIdPeekProps {
  traceId: string;
}

/**
 * Standalone eye-icon trigger that opens the trace drawer on click and
 * shows the same hover-peek popover as `<TracePreviewHoverCard>`.
 *
 * Used in dense table rows where there's no other natural "go to
 * trace" affordance to attach the popover to. For surfaces that
 * already have a button or link you can wrap, prefer
 * `<TracePreviewHoverCard>` directly so the eye doesn't crowd the row.
 */
export const TraceIdPeek: React.FC<TraceIdPeekProps> = ({ traceId }) => {
  const { openDrawer } = useDrawer();

  const handleOpenDrawer = (e: React.MouseEvent) => {
    e.stopPropagation();
    openDrawer("traceV2Details", { traceId });
  };

  return (
    <TracePreviewHoverCard traceId={traceId}>
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
    </TracePreviewHoverCard>
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
          {trace.traceName || trace.name}
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
        <Text textStyle="2xs" color="fg.subtle">
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
      <Text textStyle="2xs" color="fg" fontWeight="medium">
        {value}
      </Text>
    </HStack>
  );
}
