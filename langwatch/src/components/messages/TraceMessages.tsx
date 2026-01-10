import {
  Alert,
  Avatar,
  Box,
  Grid,
  GridItem,
  HStack,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import React, { type PropsWithChildren, useEffect, useState } from "react";
import { CornerDownRight } from "react-feather";
import { stringifyIfObject } from "~/utils/stringifyIfObject";
import { AnnotationExpectedOutputs } from "../../components/AnnotationExpectedOutputs";
import { Annotations } from "../../components/Annotations";
import { Markdown } from "../../components/Markdown";
import { EventsCounter } from "../../components/messages/EventsCounter";
import {
  getSlicedExpectedOutput,
  MessageCardJsonOutput,
} from "../../components/messages/MessageCard";
import { useAnnotationCommentStore } from "../../hooks/useAnnotationCommentStore";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Trace } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { isJson } from "../../utils/isJson";
import { isPythonRepr } from "../../utils/parsePythonInsideJson";
import { getExtractedInput } from "../../utils/traceExtraction";
import { SmallLabel } from "../SmallLabel";
import { RedactedField } from "../ui/RedactedField";
import { Tooltip } from "../ui/tooltip";
import {
  MessageHoverActions,
  useTranslationState,
} from "./MessageHoverActions";

export const TraceMessages = React.forwardRef(function TraceMessages(
  {
    trace,
    highlighted,
    index,
    loadingMore,
  }: {
    trace: Trace;
    highlighted?: boolean;
    index: "only" | "first" | "last" | "other";
    loadingMore?: boolean;
  },
  ref,
) {
  const { project } = useOrganizationTeamProject();

  const [hover, setHover] = useState(false);
  const [showTools, setShowTools] = useState(false);

  const {
    setCommentState,
    action,
    conversationHasSomeComments,
    setConversationHasSomeComments,
  } = useAnnotationCommentStore();

  const translationState = useTranslationState();

  const annotations = api.annotation.getByTraceId.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: trace.trace_id,
    },
    { enabled: !!project?.id },
  );

  const showAnnotations = action == "new" || conversationHasSomeComments;

  // Workaround for all trace messages to have the same width in case any of the others has annotations
  useEffect(() => {
    if (annotations.data && annotations.data.length > 0) {
      setConversationHasSomeComments(true);
    }

    return () => {
      setConversationHasSomeComments(false);
    };
  }, [annotations.data]);

  return (
    <VStack ref={ref as any} align="start" width="full" gap={0}>
      <Grid
        templateColumns="repeat(4, 1fr)"
        gap={5}
        width="full"
        maxWidth={showAnnotations ? "1420px" : "1000px"}
        alignItems="start"
        role="group"
      >
        <GridItem
          colSpan={showAnnotations ? 3 : 4}
          height="100%"
          maxWidth="1000px"
          width="100%"
          position="relative"
          background={highlighted ? "blue.50" : hover ? "gray.50" : "white"}
          paddingLeft={10}
          paddingRight={10}
          paddingY={4}
          borderX="1px solid"
          borderTop={
            highlighted ||
            (!loadingMore && (index === "first" || index === "only"))
              ? "1px solid"
              : "none"
          }
          {...(loadingMore
            ? { borderRadius: "0" }
            : index === "only"
              ? { borderRadius: "lg" }
              : index === "first"
                ? { borderTopRadius: "lg" }
                : index === "last"
                  ? { borderBottomRadius: "lg" }
                  : { borderRadius: "0" })}
          borderBottom={
            highlighted || index === "last" || index === "only"
              ? "1px solid"
              : "none"
          }
          borderColor={highlighted ? "blue.200" : "gray.300"}
          onMouseEnter={() => setShowTools(true)}
          onMouseMove={() => setShowTools(true)}
          onMouseLeave={() => setShowTools(false)}
        >
          <VStack gap={0} marginRight={5} width="100%" align="start">
            {loadingMore && (
              <HStack gap={3} paddingBottom={6}>
                <Spinner size="sm" />
                <Text>Loading messages...</Text>
              </HStack>
            )}
            {showTools && (
              <MessageHoverActions trace={trace} {...translationState} />
            )}
            {trace.metadata.thread_id && (
              <Text color="gray.400" fontSize="xs">
                Thread ID: {trace.metadata.thread_id}
              </Text>
            )}
            <Message
              author="Input"
              avatar={
                <Avatar.Root size="sm">
                  <Avatar.Fallback />
                </Avatar.Root>
              }
              timestamp={trace.timestamps.started_at}
              paddingTop="20px"
            >
              <Box paddingY="6px" marginBottom="38px">
                <RedactedField field="input">
                  <Markdown className="markdown">
                    {translationState.translatedTextInput &&
                    translationState.translationActive
                      ? translationState.translatedTextInput
                      : getExtractedInput(trace)}
                  </Markdown>
                </RedactedField>
              </Box>
            </Message>
            <Message
              author={project?.name ?? ""}
              avatar={
                <Avatar.Root size="sm" background="orange.400">
                  <Avatar.Fallback name={project?.name} />
                </Avatar.Root>
              }
              timestamp={
                trace.timestamps.started_at +
                (trace.metrics?.first_token_ms ??
                  trace.metrics?.total_time_ms ??
                  0)
              }
            >
              {trace.error && !trace.output?.value ? (
                <VStack alignItems="flex-start" gap={2} paddingY={2}>
                  <Box
                    fontSize="11px"
                    color="red.400"
                    textTransform="uppercase"
                    fontWeight="bold"
                  >
                    Exception
                  </Box>
                  <Text color="red.900">{trace.error.message}</Text>
                </VStack>
              ) : trace.output?.value &&
                (isJson(stringifyIfObject(trace.output.value)) ||
                  isPythonRepr(stringifyIfObject(trace.output.value))) ? (
                <MessageCardJsonOutput
                  value={stringifyIfObject(trace.output.value)}
                />
              ) : trace.output?.value ? (
                <VStack
                  alignItems="flex-start"
                  gap={2}
                  paddingY={2}
                  width="80%"
                >
                  <Box
                    onDoubleClick={() => {
                      setCommentState?.({
                        traceId: trace.trace_id,
                        action: "new",
                        annotationId: undefined,
                        expectedOutput: stringifyIfObject(trace.output?.value),
                        expectedOutputAction: "new",
                      });
                    }}
                  >
                    <RedactedField field="output">
                      <Markdown className="markdown">
                        {translationState.translatedTextOutput &&
                        translationState.translationActive
                          ? translationState.translatedTextOutput
                          : stringifyIfObject(trace.output.value)}
                      </Markdown>
                    </RedactedField>
                  </Box>

                  <AnnotationExpectedOutputs
                    traceId={trace.trace_id}
                    setHover={setHover}
                    output={stringifyIfObject(trace.output.value)}
                  />
                </VStack>
              ) : (
                <Text paddingY={2}>{"<empty>"}</Text>
              )}
              {trace.expected_output && (
                <Alert.Root status="warning">
                  <Alert.Indicator>
                    <CornerDownRight size="16" />
                  </Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title>Expected Output:</Alert.Title>
                    <Text>
                      {translationState.translatedTextOutput &&
                      translationState.translationActive
                        ? translationState.translatedTextOutput
                        : getSlicedExpectedOutput(trace)}
                    </Text>
                  </Alert.Content>
                </Alert.Root>
              )}
              <HStack fontSize="13px" color="gray.400">
                <EventsCounter trace={trace} addDot={false} />
              </HStack>
            </Message>
            {index === "only" && <Box width="100%" height="200px" />}
          </VStack>
        </GridItem>
        {showAnnotations && (
          <GridItem
            minWidth="420px"
            paddingRight={6}
            paddingLeft={4}
            onClick={(e) => {
              e.stopPropagation();

              setCommentState?.({
                traceId: trace.trace_id,
                action: "new",
                annotationId: undefined,
                expectedOutputAction: "new",
                expectedOutput: null,
              });
            }}
          >
            <Annotations traceId={trace.trace_id} setHover={setHover} />
          </GridItem>
        )}
      </Grid>
    </VStack>
  );
});

export function Message({
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
    <HStack width="full" paddingTop={paddingTop} align="start" gap={3}>
      {avatar}
      <VStack
        align="start"
        gap={0}
        width="full"
        className="content-hover"
        wordBreak="break-all"
      >
        <HStack width="full">
          <SmallLabel>{author}</SmallLabel>
          <Spacer />
          {timestampDate && timeAgo && (
            <Tooltip content={timestampDate?.toLocaleString()}>
              <Text color="gray.400">{timeAgo}</Text>
            </Tooltip>
          )}
        </HStack>
        {children}
      </VStack>
    </HStack>
  );
}
