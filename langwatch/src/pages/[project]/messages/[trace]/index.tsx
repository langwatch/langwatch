import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { api } from "../../../../utils/api";
import {
  TraceDetailsLayout,
  useTraceFromUrl,
} from "../../../../components/traces/TraceDetailsLayout";
import {
  Alert,
  AlertIcon,
  Avatar,
  Box,
  HStack,
  Skeleton,
  Text,
  VStack,
  Container,
  Spinner,
  Fade,
  Spacer,
  Tooltip,
} from "@chakra-ui/react";
import { TraceSummary } from "../../../../components/traces/Summary";
import type { Trace } from "../../../../server/tracer/types";
import Markdown from "react-markdown";
import React, { useEffect, useRef } from "react";
import { formatDistanceToNow } from "date-fns";

export default function Conversation() {
  const { trace } = useTraceFromUrl();
  const { project } = useOrganizationTeamProject();

  const currentTraceRef = useRef<HTMLDivElement>(null);
  const threadTraces = api.traces.getTracesByThreadId.useQuery(
    {
      projectId: project?.id ?? "",
      threadId: trace.data?.thread_id ?? "",
    },
    {
      enabled: !!project && !!trace.data?.thread_id,
    }
  );

  useEffect(() => {
    if (threadTraces.data && threadTraces.data?.length > 0) {
      currentTraceRef.current?.scrollIntoView({
        behavior: "instant",
        block: "center",
      });
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!threadTraces.data]);

  return (
    <TraceDetailsLayout>
      {trace.data ? (
        <TraceSummary trace={trace.data} />
      ) : trace.isError ? (
        <Alert status="error">
          <AlertIcon />
          An error has occurred trying to load this trace
        </Alert>
      ) : (
        <VStack gap={4} width="full">
          <Skeleton width="full" height="20px" />
          <Skeleton width="full" height="20px" />
          <Skeleton width="full" height="20px" />
        </VStack>
      )}
      <Box
        border="1px solid"
        borderColor="gray.200"
        width="full"
        maxHeight="calc(min(max(100vh - 400px, 700px), 100vh - 50px))"
        overflowY="scroll"
      >
        {trace.data ? (
          <VStack align="start" width="full" spacing={0}>
            {trace.data.thread_id ? (
              threadTraces.data ? (
                threadTraces.data
                  .filter(
                    (trace_) =>
                      trace_.id != trace.data.id &&
                      trace_.timestamps.started_at <
                        trace.data.timestamps.started_at
                  )
                  .map((trace) => (
                    <TraceMessages key={trace.id} trace={trace} />
                  ))
              ) : threadTraces.isLoading ? (
                <Container maxWidth="800px" paddingTop={8} paddingBottom={4}>
                  <HStack spacing={3}>
                    <Spinner size="sm" />
                    <Text>Loading previous messages...</Text>
                  </HStack>
                </Container>
              ) : threadTraces.error ? (
                <Container maxWidth="800px" paddingTop={8} paddingBottom={4}>
                  <Text color="red.500">
                    Something went wrong trying to load previous messages
                  </Text>
                </Container>
              ) : null
            ) : (
              <Container maxWidth="800px" paddingTop={8} paddingBottom={4}>
                <Text fontStyle="italic" color="gray.500">
                  Add the thread_id to capture and visualize the whole
                  conversation. Read more on our docs.
                </Text>
              </Container>
            )}
            <TraceMessages
              trace={trace.data}
              ref={currentTraceRef}
              highlighted={threadTraces.data && threadTraces.data.length > 1}
            />
            {trace.data.thread_id && threadTraces.data
              ? threadTraces.data
                  .filter(
                    (trace_) =>
                      trace_.id != trace.data.id &&
                      trace_.timestamps.started_at >
                        trace.data.timestamps.started_at
                  )
                  .map((trace) => (
                    <TraceMessages key={trace.id} trace={trace} />
                  ))
              : null}
          </VStack>
        ) : trace.isLoading ? (
          <Container maxWidth="800px" padding={8}>
            <VStack gap={4} width="full">
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
            </VStack>
          </Container>
        ) : null}
      </Box>
    </TraceDetailsLayout>
  );
}

const TraceMessages = React.forwardRef(function TraceMessages(
  {
    trace,
    highlighted,
  }: {
    trace: Trace;
    highlighted?: boolean;
  },
  ref
) {
  const { project } = useOrganizationTeamProject();

  if (!project) return null;

  return (
    <VStack
      ref={ref as any}
      align="start"
      width="full"
      spacing={2}
      _first={{ paddingTop: 4 }}
      _last={{ paddingBottom: 8 }}
    >
      {highlighted && (
        <Text
          marginTop="-28px"
          paddingX={4}
          fontSize={13}
          fontWeight={500}
          color="blue.800"
          animation="fadeIn 0.8s"
        >
          Selected message
        </Text>
      )}
      <Box
        width="full"
        transition="all 0.3s ease-in-out"
        borderY="1px solid"
        borderColor={highlighted ? "blue.500" : "white"}
        background={highlighted ? "blue.50" : "white"}
      >
        <Container maxWidth="800px">
          <HStack align="start" spacing={3} paddingTop="20px">
            <Avatar size="sm" />
            <VStack
              align="start"
              spacing={0}
              width="full"
              className="content-hover"
            >
              <HStack width="full">
                <Text fontWeight="bold">Input</Text>
                <Spacer />
                <Tooltip
                  label={new Date(trace.timestamps.started_at).toLocaleString()}
                >
                  <Text color="gray.400" className="show-on-hover">
                    {formatDistanceToNow(
                      new Date(trace.timestamps.started_at),
                      {
                        addSuffix: true,
                      }
                    )}
                  </Text>
                </Tooltip>
              </HStack>
              <Text paddingY="6px" marginBottom="38px">
                {trace.input.value}
              </Text>
            </VStack>
          </HStack>
          <HStack align="start" spacing={3}>
            <Avatar size="sm" name={project.name} background="orange.400" />
            <VStack
              align="start"
              spacing={0}
              width="full"
              className="content-hover"
            >
              <HStack width="full">
                <Text fontWeight="bold">{project.name}</Text>
                <Spacer />
                <Tooltip
                  label={new Date(
                    trace.timestamps.inserted_at
                  ).toLocaleString()}
                >
                  <Text color="gray.400" className="show-on-hover">
                    {formatDistanceToNow(
                      new Date(trace.timestamps.inserted_at),
                      {
                        addSuffix: true,
                      }
                    )}
                  </Text>
                </Tooltip>
              </HStack>
              <Markdown className="markdown markdown-conversation-history">
                {trace.error ? trace.error.message : trace.output?.value}
              </Markdown>
            </VStack>
          </HStack>
        </Container>
      </Box>
    </VStack>
  );
});
