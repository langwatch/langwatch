import { Button, HStack, type StackProps } from "@chakra-ui/react";
import { LuListTree } from "react-icons/lu";
import { TracePreviewHoverCard } from "@langwatch/trace-web/explorer/components/TraceIdPeek";
import { useTraceDetailsDrawer } from "../../hooks/use-trace-details-drawer";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { api } from "../../behavior/scenario-api";

// Constants
export const TRACE_QUERY_CONFIG = {
  retry: 10,
  retryDelay: (attemptIndex: number) => Math.min(2000 * 2 ** attemptIndex, 60000),
  // Traces are immutable once written, so caching forever is correct.
  staleTime: Infinity,
  gcTime: Infinity,
} as const;

interface TraceMessageProps extends StackProps {
  traceId: string;
}

export function TraceMessage({ traceId, ...props }: TraceMessageProps) {
  const { project } = useOrganizationTeamProject();

  const traceQuery = api.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId: traceId },
    {
      enabled: !!project && !!traceId,
      ...TRACE_QUERY_CONFIG,
    },
  );

  if (traceQuery.isLoading || traceQuery.isError || !traceQuery.data) {
    return null;
  }

  return <TraceSuccessState {...props} traceId={traceId} />;
}

// Success state component
function TraceSuccessState({ traceId, ...props }: { traceId: string } & StackProps) {
  // useTraceDetailsDrawer opens the Trace Explorer drawer. The hover-peek
  // popover is unaffected.
  const { openTraceDetailsDrawer } = useTraceDetailsDrawer();

  return (
    <HStack paddingBottom={4} {...props}>
      {/* Hover-peek now wraps the button itself — the standalone eye
          icon was visually orphaned and the affordance was unclear.
          Click still opens the trace drawer; hover shows the same
          compact summary popover. */}
      <TracePreviewHoverCard traceId={traceId}>
        <Button colorPalette="gray" onClick={() => openTraceDetailsDrawer({ traceId })}>
          <LuListTree />
          View Trace
        </Button>
      </TracePreviewHoverCard>
    </HStack>
  );
}
