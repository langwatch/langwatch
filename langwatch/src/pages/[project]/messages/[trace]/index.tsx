import {
  Avatar,
  Box,
  Container,
  HStack,
  Heading,
  Skeleton,
  SkeletonCircle,
  Spacer,
  Spinner,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { format, formatDistanceToNow } from "date-fns";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import React, {
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import Markdown from "react-markdown";
import { DashboardLayout } from "../../../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "../../../../hooks/useTraceDetailsState";
import { TeamRoleGroup } from "../../../../server/api/permission";
import type { Trace } from "../../../../server/tracer/types";
import { api } from "../../../../utils/api";
import { isNotFound } from "../../../../utils/trpcError";

import { useDrawer } from "../../../../components/CurrentDrawer";
import { getExtractedInput } from "../../../../components/messages/MessageCard";
import { formatTimeAgo } from "../../../../utils/formatTimeAgo";
import { ThumbsUp } from "react-feather";

export default function TraceDetails() {
  const { hasTeamPermission } = useOrganizationTeamProject();
  const router = useRouter();
  const { traceId, trace, openTab } = useTraceDetailsState(
    (router.query.trace as string) ?? ""
  );
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const { openDrawer } = useDrawer();

  useEffect(() => {
    if (trace.data?.metadata.thread_id) {
      setThreadId(trace.data.metadata.thread_id);
    }
  }, [trace.data?.metadata.thread_id]);

  const [initialDelay, setInitialDelay] = useState<boolean>(false);

  useEffect(() => {
    if (!hasTeamPermission(TeamRoleGroup.SPANS_DEBUG) || !traceId) return;
    setTimeout(
      () => {
        const isOpen = (!!threadId || !!trace.data) && !!openTab;
        openDrawer("traceDetails", {
          traceId: traceId,
        });

        if (isOpen) setInitialDelay(true);
      },
      initialDelay ? 0 : 400
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!openTab, !!trace.data]);

  if (isNotFound(trace.error)) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout backgroundColor="white">
      <VStack
        maxWidth="1600"
        paddingY={6}
        paddingX={12}
        alignSelf="flex-start"
        alignItems="flex-start"
        width="full"
        spacing={10}
      >
        <VStack spacing={6} alignItems="flex-start" width="full">
          <HStack
            gap={5}
            align={{ base: "start", md: "center" }}
            flexDirection={{ base: "column", md: "row" }}
          >
            <Heading as="h1">Message Details</Heading>
            <Text color="gray.400" fontFamily="mono">
              (ID: {traceId})
            </Text>
          </HStack>
        </VStack>
      </VStack>
      <Box
        alignSelf="flex-start"
        alignItems="flex-start"
        paddingX={12}
        width="100%"
        maxWidth="1600"
      >
        <HStack
          align="start"
          width="full"
          spacing={0}
          border="1px solid"
          borderColor="gray.200"
          alignItems="stretch"
          height="100%"
        >
          <Box
            transition="all 0.3s ease-in-out"
            width={"full"}
            height="100vh"
            maxHeight="100vh"
            overflowX="hidden"
            overflowY="auto"
            position="sticky"
            top={0}
            id="conversation-scroll-container"
            background={trace.data ? "gray.50" : "white"}
            paddingBottom="220px"
          >
            <Conversation threadId={threadId} />
          </Box>
        </HStack>
      </Box>
    </DashboardLayout>
  );
}

function Conversation({ threadId }: { threadId?: string }) {
  const router = useRouter();
  const { traceId, trace } = useTraceDetailsState(
    (router.query.trace as string) ?? ""
  );
  const { project } = useOrganizationTeamProject();

  const currentTraceRef = useRef<HTMLDivElement>(null);
  const threadTraces = api.traces.getTracesByThreadId.useQuery(
    {
      projectId: project?.id ?? "",
      threadId: threadId ?? "",
    },
    {
      enabled: !!project && !!threadId,
    }
  );

  const modalTraceId = router.query["drawer.traceId"];

  useEffect(() => {
    if (threadTraces.data && threadTraces.data?.length > 0) {
      const container = document.getElementById(
        "conversation-scroll-container"
      )!;
      container.scrollTop = (currentTraceRef.current?.offsetTop ?? 0) - 56;
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!threadTraces.data]);

  return (
    <Box width="full" minWidth="800px">
      {!!threadId || trace.data ? (
        <VStack
          align="start"
          width="full"
          spacing={0}
          background="white"
          borderBottom="1px solid"
          borderColor="gray.200"
        >
          {threadId ? (
            threadTraces.data ? (
              threadTraces.data.map((trace) => (
                <TraceMessages
                  key={trace.trace_id}
                  trace={trace}
                  ref={trace.trace_id == traceId ? currentTraceRef : undefined}
                  highlighted={trace.trace_id == modalTraceId}
                />
              ))
            ) : threadTraces.error ? (
              <Container maxWidth="800px" paddingTop={8} paddingBottom={4}>
                <Text color="red.500">
                  Something went wrong trying to load previous messages
                </Text>
              </Container>
            ) : (
              <Container
                maxWidth="800px"
                height="56px"
                paddingTop={4}
                paddingBottom={4}
              >
                <HStack spacing={3}>
                  <Spinner size="sm" />
                  <Text>Loading messages...</Text>
                </HStack>
              </Container>
            )
          ) : null}
          {!threadId && <Box height="56px" />}
          {trace.data && !threadTraces.data && (
            <TraceMessages trace={trace.data} highlighted={!!modalTraceId} />
          )}
          {trace.data && !trace.data.metadata.thread_id && (
            <Container maxWidth="800px" padding={8}>
              <Text fontStyle="italic" color="gray.500">
                Pass the thread_id on your integration to capture and visualize
                the whole conversation or associated actions. Read more on our
                docs.
              </Text>
            </Container>
          )}
        </VStack>
      ) : trace.isLoading ? (
        <Container
          width="full"
          maxWidth="800px"
          background="white"
          paddingTop="20px"
          paddingBottom="30px"
        >
          <VStack gap="40px" width="full" align="start" paddingTop="56px">
            <Message
              author=""
              avatar={<SkeletonCircle minWidth="32px" minHeight="32px" />}
            >
              <VStack gap={4} width="full" align="start">
                <Skeleton width="600px" height="20px" />
                <Skeleton width="600px" height="20px" />
              </VStack>
            </Message>
            <Message
              author=""
              avatar={<SkeletonCircle minWidth="32px" minHeight="32px" />}
            >
              <VStack gap={4} width="full" align="start">
                <Skeleton width="600px" height="20px" />
                <Skeleton width="600px" height="20px" />
              </VStack>
            </Message>
          </VStack>
        </Container>
      ) : null}
    </Box>
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

  const annotations = api.annotation.getByTraceId.useQuery({
    projectId: project?.id ?? "",
    traceId: trace.trace_id,
  });

  console.log("test", annotations.data);

  return (
    <VStack
      ref={ref as any}
      align="start"
      width="full"
      spacing={2}
      _first={{ paddingTop: 4 }}
      _last={{ paddingBottom: 0 }}
    >
      <Box
        width="full"
        borderY="1px solid"
        borderColor={highlighted ? "blue.500" : "white"}
        background={highlighted ? "blue.50" : "white"}
        _hover={{ background: highlighted ? "blue.50" : "gray.50" }}
      >
        <Container maxWidth="6xl">
          <HStack width="full">
            <Box
              width="full"
              borderRight="1px solid"
              borderColor="gray.200"
              marginRight={4}
              paddingRight={4}
            >
              <Message
                trace={trace}
                author="Input"
                avatar={<Avatar size="sm" />}
                timestamp={trace.timestamps.started_at}
                paddingTop="20px"
              >
                <Text paddingY="6px" marginBottom="38px" whiteSpace="pre-wrap">
                  {getExtractedInput(trace)}ssdasdasdasd
                </Text>
              </Message>
              <Message
                trace={trace}
                author={project?.name ?? ""}
                avatar={
                  <Avatar
                    size="sm"
                    name={project?.name}
                    background="orange.400"
                  />
                }
                timestamp={
                  trace.timestamps.started_at +
                  (trace.metrics.first_token_ms ??
                    trace.metrics.total_time_ms ??
                    0)
                }
              >
                {trace.error && !trace.output?.value ? (
                  <VStack alignItems="flex-start" spacing={2} paddingY={2}>
                    <Box
                      fontSize={11}
                      color="red.400"
                      textTransform="uppercase"
                      fontWeight="bold"
                    >
                      Exception
                    </Box>
                    <Text color="red.900">{trace.error.message}</Text>
                  </VStack>
                ) : trace.output?.value ? (
                  <Markdown className="markdown markdown-conversation-history">
                    {trace.output.value}
                  </Markdown>
                ) : (
                  <Text paddingY={2}>{"<empty>"}</Text>
                )}
              </Message>
            </Box>
            {annotations.data && (
              <Box>
                <Annotation annotation={annotations.data} />
              </Box>
            )}
          </HStack>
        </Container>
      </Box>
    </VStack>
  );
});

type Annotation = {
  comment: string;
  isThumbsUp: boolean;
  createdAt: Date;
};

const Annotation = ({ annotation }: { annotation: Annotation }) => {
  return (
    <Box
      backgroundColor="gray.100"
      padding={3}
      borderRadius={5}
      width="300px"
      align="start"
    >
      <VStack align="start">
        <HStack width="full" align={"top"}>
          <VStack align="start" spacing={0}>
            <Text fontWeight="bold">{annotation.name}</Text>
            <Text fontSize="sm">{annotation.createdAt.toLocaleString()}</Text>
          </VStack>
          <Spacer />
          <ThumbsUp size={"18px"} />
        </HStack>
        <Text>{annotation.comment}</Text>
      </VStack>
    </Box>
  );
};

function Message({
  trace,
  author,
  avatar,
  timestamp,
  paddingTop,
  children,
}: PropsWithChildren<{
  trace?: Trace;
  author: string;
  avatar: React.ReactNode;
  timestamp?: number;
  paddingTop?: string;
}>) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();

  // show time ago if less than a day old
  const timestampDate = timestamp ? new Date(timestamp) : undefined;
  const timeAgo = formatTimeAgo(timestamp!);

  if (!project) return null;

  return (
    <HStack
      width="full"
      paddingTop={paddingTop}
      align="start"
      spacing={3}
      cursor="pointer"
      role="button"
      onClick={() => {
        if (!trace) return;
        openDrawer("traceDetails", {
          traceId: trace.trace_id,
        });
      }}
    >
      {avatar}
      <VStack align="start" spacing={0} width="full" className="content-hover">
        <HStack width="full">
          <Text fontWeight="bold">{author}</Text>
          <Spacer />
          {timestampDate && timeAgo && (
            <Tooltip label={timestampDate.toLocaleString()}>
              <Text color="gray.400">{timeAgo}</Text>
            </Tooltip>
          )}
        </HStack>
        {children}
      </VStack>
    </HStack>
  );
}
