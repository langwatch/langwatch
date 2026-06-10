import {
  Alert,
  Button,
  HStack,
  Spinner,
  type StackProps,
  Text,
} from "@chakra-ui/react";
import { LuListTree, LuRefreshCw } from "react-icons/lu";
import { TracePreviewHoverCard } from "~/features/traces-v2/components/TraceIdPeek";
import { useTraceDetailsDrawer } from "~/hooks/useTraceDetailsDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { easyCatchToast } from "../../utils/easyCatchToast";

// Constants
const TRACE_QUERY_CONFIG = {
  retry: 10,
  retryDelay: (attemptIndex: number) =>
    Math.min(2000 * 2 ** attemptIndex, 60000),
  // Traces are immutable once written, so caching forever is correct.
  staleTime: Infinity,
  cacheTime: Infinity,
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
function TraceSuccessState({
  traceId,
  ...props
}: { traceId: string } & StackProps) {
  // useTraceDetailsDrawer routes to v1 or v2 based on the operator's
  // localStorage opt-in (see `useTracesV2Preference`). The hover-peek
  // popover is the same in both worlds.
  const { openTraceDetailsDrawer } = useTraceDetailsDrawer();

  return (
    <HStack paddingBottom={4} {...props}>
      {/* Hover-peek now wraps the button itself — the standalone eye
          icon was visually orphaned and the affordance was unclear.
          Click still opens the trace drawer; hover shows the same
          compact summary popover. */}
      <TracePreviewHoverCard traceId={traceId}>
        <Button
          colorPalette="gray"
          onClick={() =>
            openTraceDetailsDrawer({ traceId, selectedTab: "traceDetails" })
          }
        >
          <LuListTree />
          View Trace
        </Button>
      </TracePreviewHoverCard>
    </HStack>
  );
}
