import {
  Alert,
  Button,
  HStack,
  Spinner,
  type StackProps,
  Text,
} from "@chakra-ui/react";
import { LuListTree, LuRefreshCw } from "react-icons/lu";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { easyCatchToast } from "../../utils/easyCatchToast";

// Constants
const TRACE_QUERY_CONFIG = {
  retry: 10,
  retryDelay: (attemptIndex: number) =>
    Math.min(2000 * 2 ** attemptIndex, 60000),
  staleTime: Infinity, // Never consider successful data stale
  cacheTime: Infinity, // Cache successful results indefinitely
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

  // Split rendering logic into separate functions
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
  const { openDrawer, drawerOpen } = useDrawer();

  return (
    <HStack paddingBottom={4} {...props}>
      <Button
        colorPalette="gray"
        onClick={() => {
          if (drawerOpen("traceDetails")) {
            openDrawer(
              "traceDetails",
              {
                traceId: traceId ?? "",
                selectedTab: "traceDetails",
              },
              { replace: true },
            );
          } else {
            openDrawer("traceDetails", {
              traceId: traceId ?? "",
              selectedTab: "traceDetails",
            });
          }
        }}
      >
        <LuListTree />
        View Trace
      </Button>
    </HStack>
  );
}
