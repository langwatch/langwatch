import {
  Alert,
  AlertTitle,
  Avatar,
  Box,
  Container,
  Grid,
  GridItem,
  Heading,
  HStack,
  Image,
  Skeleton,
  SkeletonCircle,
  Spacer,
  Spinner,
  Text,
  Tooltip,
  useToast,
  VStack,
} from "@chakra-ui/react";
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
import type { Trace } from "../../../../server/tracer/types";
import { api } from "../../../../utils/api";
import { isNotFound } from "../../../../utils/trpcError";

import { CornerDownRight, Edit } from "react-feather";
import remarkGfm from "remark-gfm";
import { Annotations } from "../../../../components/Annotations";
import { useDrawer } from "../../../../components/CurrentDrawer";
import { EventsCounter } from "../../../../components/messages/EventsCounter";
import {
  getExtractedInput,
  getSlicedExpectedOutput,
  MessageCardJsonOutput,
} from "../../../../components/messages/MessageCard";
import { formatTimeAgo } from "../../../../utils/formatTimeAgo";
import { isJson } from "../../../../utils/isJson";
import { isPythonRepr } from "../../../../utils/parsePythonInsideJson";

import { useAnnotationCommentStore } from "../../../../hooks/useAnnotationCommentStore";

export default function TraceDetails() {
  const router = useRouter();
  const { traceId, trace } = useTraceDetailsState(
    (router.query.trace as string) ?? ""
  );

  const [threadId, setThreadId] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (trace.data?.metadata.thread_id) {
      setThreadId(trace.data.metadata.thread_id);
    }
  }, [trace.data?.metadata.thread_id]);

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
            background="gray.50"
            paddingBottom="220px"
          >
            <Conversation threadId={threadId} traceId={traceId} />
          </Box>
        </HStack>
      </Box>
    </DashboardLayout>
  );
}

export function Conversation({
  threadId,
  traceId,
}: {
  threadId?: string;
  traceId: string;
}) {
  const router = useRouter();
  const traceIdParam = (router.query.trace as string) || traceId;
  const { trace } = useTraceDetailsState(traceIdParam);

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

  const modalTraceId =
    threadTraces.data?.length && threadTraces.data?.length > 1
      ? router.query["drawer.traceId"]
      : undefined;

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
      <VStack
        align="start"
        width="full"
        spacing={0}
        background="white"
        borderBottom="1px solid"
        borderColor="gray.200"
      >
        {!!threadId || trace.data ? (
          <>
            {threadId ? (
              threadTraces.data ? (
                threadTraces.data.map((trace) => (
                  <TraceMessages
                    key={trace.trace_id}
                    trace={trace}
                    ref={
                      trace.trace_id == traceId ? currentTraceRef : undefined
                    }
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
            {trace.data && !threadTraces.data && (
              <TraceMessages trace={trace.data} highlighted={!!modalTraceId} />
            )}
            {trace.data && !trace.data.metadata.thread_id && (
              <Container maxWidth="800px" padding={8}>
                <Text fontStyle="italic" color="gray.500">
                  Pass the thread_id on your integration to capture and
                  visualize the whole conversation or associated actions. Read
                  more on our docs.
                </Text>
              </Container>
            )}
          </>
        ) : trace.isLoading ? (
          <Container
            maxWidth="1200px"
            width="full"
            borderY="1px solid white"
            paddingY={4}
          >
            <Grid templateColumns="repeat(4, 1fr)">
              <GridItem colSpan={3}>
                <Box
                  minWidth="65%"
                  position="relative"
                  borderRight="1px solid"
                  borderColor="gray.200"
                  marginRight={10}
                  paddingLeft={10}
                  paddingRight={10}
                >
                  <Message
                    author=""
                    avatar={<SkeletonCircle minWidth="32px" minHeight="32px" />}
                    paddingTop="20px"
                  >
                    <Box paddingY="6px" marginBottom="62px">
                      <VStack gap={4} width="full" align="start">
                        <Skeleton width="600px" maxWidth="100%" height="20px" />
                        <Skeleton width="600px" maxWidth="100%" height="20px" />
                      </VStack>
                    </Box>
                  </Message>
                  <Message
                    author=""
                    avatar={<SkeletonCircle minWidth="32px" minHeight="32px" />}
                  >
                    <Box paddingY="6px" marginBottom="62px">
                      <VStack gap={4} width="full" align="start">
                        <Skeleton width="600px" maxWidth="100%" height="20px" />
                        <Skeleton width="600px" maxWidth="100%" height="20px" />
                      </VStack>
                    </Box>
                  </Message>
                </Box>
              </GridItem>
              <GridItem minWidth="300px"></GridItem>
            </Grid>
          </Container>
        ) : null}
      </VStack>
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
  const { openDrawer, isDrawerOpen } = useDrawer();
  const toast = useToast();

  const translateAPI = api.translate.translate.useMutation();
  const [translatedTextInput, setTranslatedTextInput] = useState<string | null>(
    null
  );
  const [translatedTextOutput, setTranslatedTextOutput] = useState<
    string | null
  >(null);

  const [translationActive, setTranslationActive] = useState(false);

  const [showAnnotationHover, setShowAnnotationHover] = useState(false);

  const { setCommentState } = useAnnotationCommentStore();

  const translate = () => {
    setTranslationActive(!translationActive);

    if (translatedTextInput) return;
    const inputTranslation = translateAPI.mutateAsync({
      projectId: project?.id ?? "",
      textToTranslate: getExtractedInput(trace),
    });

    const outputTranslation = translateAPI.mutateAsync({
      projectId: project?.id ?? "",
      textToTranslate: trace.output?.value ?? "",
    });

    Promise.all([inputTranslation, outputTranslation])
      .then(([inputData, outputData]) => {
        setTranslatedTextInput(inputData.translation);
        setTranslatedTextOutput(outputData.translation);
      })
      .catch(() => {
        toast({
          title: "Error translating",
          description:
            "There was an error translating the message, please try again.",
          status: "error",
          duration: 5000,
          isClosable: true,
          position: "top-right",
        });
      });
  };

  const AnnotationHover = () => {
    return (
      <VStack
        position="absolute"
        top={"50%"}
        right={-5}
        transform="translateY(-50%)"
      >
        <Tooltip label="Translate message to English" hasArrow placement="top">
          <Box
            width="38px"
            height="38px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            paddingY={2}
            paddingX={2}
            borderRadius={"50%"}
            border="1px solid"
            borderColor="gray.200"
            backgroundColor="white"
            onClick={(e) => {
              e.stopPropagation();
              translate();
            }}
            cursor="pointer"
          >
            <VStack>
              {translateAPI.isLoading ? (
                <Spinner size="sm" />
              ) : translationActive ? (
                <Image
                  src="/images/translate-active.svg"
                  alt="Translate"
                  width="20px"
                />
              ) : (
                <Image
                  src="/images/translate.svg"
                  alt="Translate"
                  width="20px"
                />
              )}
            </VStack>
          </Box>
        </Tooltip>
        <Tooltip label="Annotate" hasArrow placement="top">
          <Box
            width="38px"
            height="38px"
            display="flex"
            alignItems="center"
            justifyContent="center"
            paddingY={2}
            paddingX={2}
            borderRadius={"3xl"}
            border="1px solid"
            borderColor="gray.200"
            backgroundColor="white"
            onClick={(e) => {
              e.stopPropagation();

              setCommentState({
                traceId: trace.trace_id,
                action: "new",
                annotationId: undefined,
              });
            }}
            cursor="pointer"
          >
            <VStack>
              <Edit size={"20px"} />
            </VStack>
          </Box>
        </Tooltip>
      </VStack>
    );
  };

  return (
    <VStack ref={ref as any} align="start" width="full" spacing={2}>
      <Box
        width="full"
        borderY="1px solid"
        paddingY={4}
        borderColor={highlighted ? "blue.500" : "white"}
        background={highlighted ? "blue.50" : "white"}
        _hover={{ background: highlighted ? "blue.50" : "gray.50" }}
        onMouseEnter={() => setShowAnnotationHover(true)}
        onMouseLeave={() => setShowAnnotationHover(false)}
        position="relative"
        cursor="pointer"
        role="button"
        onClick={() => {
          if (!trace) return;
          if (isDrawerOpen("traceDetails")) {
            openDrawer(
              "traceDetails",
              {
                traceId: trace.trace_id,
                selectedTab: "traceDetails",
              },
              { replace: true }
            );
          } else {
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
            });
          }
        }}
      >
        <Container maxWidth="1400px">
          <Grid templateColumns="repeat(4, 1fr)">
            <GridItem colSpan={3}>
              <Box
                minWidth="65%"
                height="100%"
                position="relative"
                borderRight="1px solid"
                borderColor="gray.200"
                marginRight={10}
                paddingLeft={10}
                paddingRight={10}
              >
                {showAnnotationHover && <AnnotationHover />}
                <Message
                  author="Input"
                  avatar={<Avatar size="sm" />}
                  timestamp={trace.timestamps.started_at}
                  paddingTop="20px"
                >
                  <Text paddingY="6px" marginBottom="38px">
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      className="markdown markdown-conversation-history"
                    >
                      {translatedTextInput && translationActive
                        ? translatedTextInput
                        : getExtractedInput(trace)}
                    </Markdown>
                  </Text>
                </Message>
                <Message
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
                    (trace.metrics?.first_token_ms ??
                      trace.metrics?.total_time_ms ??
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
                  ) : trace.output?.value &&
                    (isJson(trace.output.value) ||
                      isPythonRepr(trace.output.value)) ? (
                    <MessageCardJsonOutput value={trace.output.value} />
                  ) : trace.output?.value ? (
                    <Markdown
                      remarkPlugins={[remarkGfm]}
                      className="markdown markdown-conversation-history"
                    >
                      {translatedTextOutput && translationActive
                        ? translatedTextOutput
                        : trace.output.value}
                    </Markdown>
                  ) : (
                    <Text paddingY={2}>{"<empty>"}</Text>
                  )}
                  {trace.expected_output && (
                    <Alert status="warning">
                      <Box paddingRight={2}>
                        <CornerDownRight size="16" />
                      </Box>
                      <AlertTitle>Expected Output:</AlertTitle>
                      <Text>
                        {translatedTextOutput && translationActive
                          ? translatedTextOutput
                          : getSlicedExpectedOutput(trace)}
                      </Text>
                    </Alert>
                  )}
                  <HStack fontSize={13} color="gray.400">
                    <EventsCounter trace={trace} addDot={false} />
                  </HStack>
                </Message>
              </Box>
            </GridItem>
            <GridItem minWidth="420px" paddingRight={6}>
              <Annotations traceId={trace.trace_id} />
            </GridItem>
          </Grid>
        </Container>
      </Box>
    </VStack>
  );
});

function Message({
  author,
  avatar,
  timestamp,
  paddingTop,
  children,
}: PropsWithChildren<{
  author: string;
  avatar: React.ReactNode;
  timestamp?: number;
  paddingTop?: string;
}>) {
  const { project } = useOrganizationTeamProject();

  // show time ago if less than a day old
  const timestampDate = timestamp ? new Date(timestamp) : undefined;
  const timeAgo = formatTimeAgo(timestamp!);

  if (!project) return null;

  return (
    <HStack width="full" paddingTop={paddingTop} align="start" spacing={3}>
      {avatar}
      <VStack
        align="start"
        spacing={0}
        width="full"
        className="content-hover"
        wordBreak="break-all"
      >
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
