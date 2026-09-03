import { Box, HoverCard, Icon, Portal } from "@chakra-ui/react";
import { Eye } from "lucide-react";
import type React from "react";
import { type ReactNode, useState } from "react";
import { useDrawer } from "../../../behavior/use-drawer";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { TracePeekSummary } from "../../../index";

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
   * Defaults to "bottom-start" — sits below the trigger and aligns to
   * its leading edge. Override when the trigger is on the far right of
   * a row and a bottom-end placement reads better.
   */
  placement?: "top" | "top-start" | "top-end" | "bottom" | "bottom-start" | "bottom-end";
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
  placement = "bottom-start",
}) => {
  const { project } = useOrganizationTeamProject();
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
            {hasHovered && project && (
              <TracePeekSummary
                projectId={project.id}
                traceId={traceId}
                occurredAtMs={occurredAtMs}
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
export const TraceIdPeek: React.FC<TraceIdPeekProps> = ({ traceId, occurredAtMs }) => {
  const { openDrawer } = useDrawer();

  const handleOpenDrawer = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Forward the timestamp as the drawer's `t` partition hint so the
    // opened drawer's per-trace reads prune partitions instead of
    // walking every weekly partition by id.
    openDrawer("traceV2Details", {
      traceId,
      ...(occurredAtMs !== undefined ? { t: String(occurredAtMs) } : {}),
    });
  };

  return (
    <TracePreviewHoverCard traceId={traceId} occurredAtMs={occurredAtMs}>
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
