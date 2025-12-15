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
  if (traceQuery.isLoading) {
    return <TraceLoadingState {...props} traceQuery={traceQuery} />;
  }

  if (traceQuery.isError || !traceQuery.data) {
    return (
      <TraceErrorState {...props} traceId={traceId} traceQuery={traceQuery} />
    );
  }

  return <TraceSuccessState {...props} traceId={traceId} />;
}

// Loading state component
function TraceLoadingState({
  traceQuery,
  ...props
}: {
  traceQuery: ReturnType<typeof api.traces.getById.useQuery>;
} & StackProps) {
  return (
    <HStack marginTop={-6} paddingBottom={4} gap={2} {...props}>
      <Spinner size="sm" />
      <Text fontSize="xs" color="gray.500">
        Loading trace...{" "}
        {traceQuery.failureCount > 0 &&
          `(retry ${traceQuery.failureCount}/${TRACE_QUERY_CONFIG.retry})`}
      </Text>
    </HStack>
  );
}

// Error state component
function TraceErrorState({
  traceId,
  traceQuery,
  ...props
}: {
  traceId: string;
  traceQuery: ReturnType<typeof api.traces.getById.useQuery>;
} & StackProps) {
  return (
    <Alert.Root status="warning" size="sm" marginY={4} {...props}>
      <Alert.Content>
        <Alert.Description>
          <HStack
            align="start"
            gap={0}
            alignItems="center"
            justifyContent="space-between"
          >
            <Text fontSize="xs">Trace not found. [trace_id: {traceId}]</Text>
            {!traceQuery.isRefetching && (
              <HStack gap={2}>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void traceQuery.refetch().catch(easyCatchToast)
                  }
                >
                  <LuRefreshCw size={12} />
                  Try again
                </Button>
              </HStack>
            )}
          </HStack>
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}

// Success state component
function TraceSuccessState({
  traceId,
  ...props
}: { traceId: string } & StackProps) {
  const { openDrawer, drawerOpen } = useDrawer();

  return (
    <HStack marginTop={-6} paddingBottom={4} {...props}>
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
