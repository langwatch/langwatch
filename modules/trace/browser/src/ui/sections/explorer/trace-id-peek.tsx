import { useDrawer } from "@langwatch/browser-host/drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { Box, HoverCard, Icon, Portal } from "@langwatch/design-system/primitives";
import { Eye } from "lucide-react";
import type React from "react";
import { type ReactNode, useState } from "react";

import { memberTenantOf, traceDrawerParams } from "../../../model/trace-drawer-params.ts";
import { TracePeekSummary } from "../trace-peek-summary.tsx";

export interface TracePreviewHoverCardProps {
  traceId: string;
  children: ReactNode;
  /**
   * Approximate trace timestamp (ms epoch) forwarded to the summary fetch as a
   * partition-pruning hint.
   */
  occurredAtMs?: number;
  /**
   * The project that owns the trace, from the surrounding row. On an aggregate
   * it is a member (ADR-177 block F): the peek and the drawer read that member.
   */
  ownerProjectId?: string;
  /**
   * Defaults to "bottom-start" — sits below the trigger and aligns to
   * its leading edge. Override when the trigger is on the far right of
   * a row and a bottom-end placement reads better.
   */
  placement?: "top" | "top-start" | "top-end" | "bottom" | "bottom-start" | "bottom-end";
}

/**
 * Hover wrapper that surfaces a compact v2 trace summary popover on any trigger you put
 * inside it. Use it to add a hover-peek to any element already mounted next to a trace
 * — buttons, links, badges — without needing a standalone trigger like the eye icon.
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
              <MemberPeekSummary
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

/** The peek summary, read from the member that owns the trace on an aggregate. */
function MemberPeekSummary({
  traceId,
  occurredAtMs,
  ownerProjectId,
}: Omit<TracePreviewHoverCardProps, "children" | "placement">) {
  const { project } = useOrganizationTeamProject();
  if (!project) return null;
  return (
    <TracePeekSummary
      projectId={project.id}
      traceId={traceId}
      occurredAtMs={occurredAtMs}
      tenantId={memberTenantOf({ ownerProjectId, projectId: project.id })}
    />
  );
}

export interface TraceIdPeekProps {
  traceId: string;
  /**
   * Approximate trace timestamp (ms epoch) forwarded as a partition-
   * pruning hint to the peek summary fetch and to the drawer it opens.
   * See {@link TracePreviewHoverCardProps.occurredAtMs}.
   */
  occurredAtMs?: number;
  /**
   * The project that owns the trace, from the surrounding row. On an aggregate
   * it is a member (ADR-177 block F): the peek and the drawer read that member.
   */
  ownerProjectId?: string;
}

/**
 * Standalone eye-icon trigger that opens the trace drawer on click and shows the same
 * hover-peek popover as `<TracePreviewHoverCard>`.
 */
export const TraceIdPeek: React.FC<TraceIdPeekProps> = (props) =>
  // Only a row naming the trace's owner can be on a member, so only it resolves
  // the current project; every other row skips that per-row read.
  props.ownerProjectId === undefined ? (
    <TraceIdPeekButton {...props} tenantId={null} />
  ) : (
    <MemberTraceIdPeek {...props} ownerProjectId={props.ownerProjectId} />
  );

/** A row that names the trace's owner: the drawer opens on that member. */
function MemberTraceIdPeek(props: TraceIdPeekProps & { ownerProjectId: string }) {
  const { project } = useOrganizationTeamProject();
  return (
    <TraceIdPeekButton
      {...props}
      tenantId={memberTenantOf({ ownerProjectId: props.ownerProjectId, projectId: project?.id })}
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
    openDrawer("traceV2Details", traceDrawerParams({ traceId, occurredAtMs, tenantId }));
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
