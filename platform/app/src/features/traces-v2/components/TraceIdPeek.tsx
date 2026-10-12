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
import { formatDuration } from "~/shared/format/time";
import { api } from "~/utils/api";
import { formatCost, formatTokens, STATUS_COLORS } from "../utils/formatters";
import { memberTenantOf, traceDrawerParams } from "../utils/traceDrawerParams";

interface TracePreviewHoverCardProps {
  traceId: string;
  children: ReactNode;
  /**
   * Approximate trace timestamp (ms epoch) forwarded to the summary
   * fetch as a partition-pruning hint. `trace_summaries` is partitioned
   * on `OccurredAt`, so a read filtered only by `traceId` cannot prune
   * partitions and walks every weekly partition including the cold S3
   * tier. Pass it from the surrounding row whenever it is known; when
   * omitted the popover falls back to the unconstrained by-id fetch.
   */
  occurredAtMs?: number;
  /**
   * The project that owns the trace, from the surrounding row. On an
   * aggregate it is a member (ADR-144 block F), and the peek and the drawer
   * it opens read that member; on a plain project it is the project itself
   * and changes nothing.
   */
  ownerProjectId?: string;
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
  occurredAtMs,
  ownerProjectId,
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
            {hasHovered && (
              <PeekPopoverContent
                traceId={traceId}
                occurredAtMs={occurredAtMs}
                ownerProjectId={ownerProjectId}
              />
            )}
          </HoverCard.Content>
        </HoverCard.Positioner>
      </Portal>
    </HoverCard.Root>
  );
};

interface TraceIdPeekProps {
  traceId: string;
  /**
   * Approximate trace timestamp (ms epoch) forwarded as a partition-
   * pruning hint to the peek summary fetch and to the drawer it opens.
   * See {@link TracePreviewHoverCardProps.occurredAtMs}.
   */
  occurredAtMs?: number;
  /**
   * The project that owns the trace, from the surrounding row. On an
   * aggregate it is a member (ADR-144 block F), and the peek and the drawer
   * it opens read that member; on a plain project it is the project itself
   * and changes nothing.
   */
  ownerProjectId?: string;
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
export const TraceIdPeek: React.FC<TraceIdPeekProps> = (props) =>
  // Only a row that names the trace's owner can be on an aggregate's member,
  // so only it resolves the current project. Every other row renders as it
  // did before, without the organization/team/project resolution per row.
  props.ownerProjectId === undefined ? (
    <TraceIdPeekButton {...props} tenantId={null} />
  ) : (
    <MemberTraceIdPeek {...props} ownerProjectId={props.ownerProjectId} />
  );

/** A row that names the trace's owner: the drawer opens on that member. */
function MemberTraceIdPeek(
  props: TraceIdPeekProps & { ownerProjectId: string },
) {
  const { project } = useOrganizationTeamProject();
  return (
    <TraceIdPeekButton
      {...props}
      tenantId={memberTenantOf({
        ownerProjectId: props.ownerProjectId,
        projectId: project?.id,
      })}
    />
  );
}

function TraceIdPeekButton({
  traceId,
  occurredAtMs,
  ownerProjectId,
  tenantId,
}: TraceIdPeekProps & { tenantId: string | null }) {
  const { openDrawer } = useDrawer();

  const handleOpenDrawer = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Forward the timestamp as the drawer's `t` partition hint so the
    // opened drawer's per-trace reads prune partitions instead of
    // walking every weekly partition by id.
    openDrawer(
      "traceV2Details",
      traceDrawerParams({ traceId, occurredAtMs, tenantId }),
    );
  };

  return (
    <TracePreviewHoverCard
      traceId={traceId}
      occurredAtMs={occurredAtMs}
      ownerProjectId={ownerProjectId}
    >
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
}

interface PeekPopoverContentProps {
  traceId: string;
  occurredAtMs?: number;
  ownerProjectId?: string;
}

/**
 * The peeked trace's header, read from the member that owns it on an
 * aggregate (ADR-144 block F).
 */
function usePeekHeader({
  traceId,
  occurredAtMs,
  ownerProjectId,
}: PeekPopoverContentProps) {
  const { project } = useOrganizationTeamProject();
  const tenantId = memberTenantOf({ ownerProjectId, projectId: project?.id });

  return api.tracesV2.header.useQuery(
    {
      projectId: project?.id ?? "",
      traceId,
      ...(occurredAtMs !== undefined ? { occurredAtMs } : {}),
      ...(tenantId !== null ? { tenantId } : {}),
      // The popover only ever shows a 2-line clamp of input/output — never
      // worth the extra spans read full resolution costs.
      full: false,
    },
    { enabled: !!project?.id, staleTime: 300_000 },
  );
}

function PeekPopoverContent(props: PeekPopoverContentProps) {
  const { data: trace, isLoading } = usePeekHeader(props);

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
          <PopoverMetric label="Model" value={trace.models[0]!} />
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
          {props.traceId.slice(0, 16)}...
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
