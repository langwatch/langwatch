import {
  Alert,
  Button,
  HStack,
  type StackProps,
  Text,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import { LuListTree, LuRefreshCw } from "react-icons/lu";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { easyCatchToast } from "../../utils/easyCatchToast";
import { getTraceErrorMessage } from "./getTraceErrorMessage";

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

  if (traceQuery.isError) {
    return (
      <TraceErrorState
        {...props}
        traceId={traceId}
        error={traceQuery.error}
        isRefetching={traceQuery.isRefetching}
        onRetry={() =>
          void traceQuery
            .refetch()
            .catch((err) => easyCatchToast(err, "TraceMessage refetch"))
        }
      />
    );
  }

  if (traceQuery.isLoading || !traceQuery.data) {
    return null;
  }

  return <TraceSuccessState {...props} traceId={traceId} />;
}

// Error state component
function TraceErrorState({
  traceId,
  error,
  isRefetching,
  onRetry,
  ...props
}: {
  traceId: string;
  error: TRPCClientErrorLike<any> | null;
  isRefetching: boolean;
  onRetry: () => void;
} & StackProps) {
  const message = getTraceErrorMessage({ error, traceId });

  return (
    <HStack paddingBottom={4} {...props}>
      <Alert.Root status="error" borderRadius="md">
        <Alert.Indicator />
        <Alert.Content>
          <Text>{message}</Text>
        </Alert.Content>
      </Alert.Root>
      <Button
        colorPalette="gray"
        size="sm"
        onClick={onRetry}
        disabled={isRefetching}
        loading={isRefetching}
      >
        <LuRefreshCw />
        Retry
      </Button>
    </HStack>
  );
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
