import {
  Alert,
  Avatar,
  Box,
  Container,
  Grid,
  GridItem,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import React, { useState, type PropsWithChildren } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { Trace } from "../../server/tracer/types";

import { CornerDownRight } from "react-feather";
import { Annotations } from "../../components/Annotations";
import { useDrawer } from "../../components/CurrentDrawer";
import { EventsCounter } from "../../components/messages/EventsCounter";
import {
  getExtractedInput,
  getSlicedExpectedOutput,
  MessageCardJsonOutput,
} from "../../components/messages/MessageCard";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { isJson } from "../../utils/isJson";
import { isPythonRepr } from "../../utils/parsePythonInsideJson";

import { Markdown } from "../../components/Markdown";
import { useAnnotationCommentStore } from "../../hooks/useAnnotationCommentStore";
import { SmallLabel } from "../SmallLabel";
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
  }: {
    trace: Trace;
    highlighted?: boolean;
    index: "only" | "first" | "last" | "other";
  },
  ref
) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, drawerOpen } = useDrawer();

  const [hover, setHover] = useState(false);

  const { setCommentState } = useAnnotationCommentStore();

  const translationState = useTranslationState();

  return (
    <VStack ref={ref as any} align="start" width="full" gap={0}>
      <Box
        role="group"
        width="full"
        borderY={highlighted ? "1px solid" : "none"}
        borderColor={highlighted ? "blue.500" : "white"}
        background={highlighted ? "blue.50" : "none"}
        position="relative"
        cursor="pointer"
        onClick={() => {
          if (!trace) return;
          if (drawerOpen("traceDetails")) {
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
                background={
                  hover
                    ? highlighted
                      ? "blue.50"
                      : "gray.50"
                    : highlighted
                    ? "blue.50"
                    : "white"
                }
                marginRight={10}
                paddingLeft={10}
                paddingRight={10}
                paddingY={4}
                borderX="1px solid"
                borderTop={
                  index === "first" || index === "only" ? "1px solid" : "none"
                }
                borderRadius={
                  index === "only"
                    ? "4px"
                    : index === "first"
                    ? "4px 4px 0 0"
                    : index === "last"
                    ? "0 0 4px 4px"
                    : "0"
                }
                borderBottom={
                  index === "last" || index === "only" ? "1px solid" : "none"
                }
                borderColor="gray.200"
                onMouseEnter={() => setHover(true)}
                onMouseMove={() => setHover(true)}
                onMouseLeave={() => setHover(false)}
              >
                {hover && (
                  <MessageHoverActions trace={trace} {...translationState} />
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
                  <Text paddingY="6px" marginBottom="38px">
                    <Markdown className="markdown markdown-conversation-history">
                      {translationState.translatedTextInput &&
                      translationState.translationActive
                        ? translationState.translatedTextInput
                        : getExtractedInput(trace)}
                    </Markdown>
                  </Text>
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
                    (isJson(trace.output.value) ||
                      isPythonRepr(trace.output.value)) ? (
                    <MessageCardJsonOutput value={trace.output.value} />
                  ) : trace.output?.value ? (
                    <Markdown className="markdown markdown-conversation-history">
                      {translationState.translatedTextOutput &&
                      translationState.translationActive
                        ? translationState.translatedTextOutput
                        : trace.output.value}
                    </Markdown>
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
              </Box>
            </GridItem>
            <GridItem
              minWidth="420px"
              paddingRight={6}
              onClick={(e) => {
                e.stopPropagation();

                setCommentState?.({
                  traceId: trace.trace_id,
                  action: "new",
                  annotationId: undefined,
                });
              }}
            >
              <Annotations traceId={trace.trace_id} setHover={setHover} />
            </GridItem>
          </Grid>
        </Container>
      </Box>
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
