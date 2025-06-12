import {
  Alert,
  Box,
  Grid,
  GridItem,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import { api } from "../../utils/api";
import { Link } from "../ui/link";
import { Message, TraceMessages } from "./TraceMessages";

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

  const { project, isPublicRoute } = useOrganizationTeamProject();

  const currentTraceRef = useRef<HTMLDivElement>(null);
  const threadTraces = api.traces.getTracesByThreadId.useQuery(
    {
      projectId: project?.id ?? "",
      threadId: threadId ?? "",
      traceId: traceId ?? "",
      isPublicRoute,
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
      if (container) {
        container.scrollTop = (currentTraceRef.current?.offsetTop ?? 0) - 176;
      } else {
        document.body.scrollTop =
          (currentTraceRef.current?.offsetTop ?? 0) - 56;
      }
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!threadTraces.data]);

  return (
    <Box width="full" minWidth="800px" paddingX={6}>
      {threadTraces.data && threadTraces.data.length > 50 && (
        <Alert.Root status="info">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              Over 50 messages found in thread, showing only the last 50.
            </Alert.Title>
          </Alert.Content>
        </Alert.Root>
      )}
      <VStack align="start" width="full" gap={0}>
        {!!threadId || trace.data ? (
          <>
            {threadId ? (
              threadTraces.data ? (
                threadTraces.data
                  .slice(Math.max(0, threadTraces.data.length - 50))
                  .map((trace, index) => (
                    <TraceMessages
                      key={trace.trace_id}
                      trace={trace}
                      index={
                        threadTraces.data.length === 1
                          ? "only"
                          : index === 0
                          ? "first"
                          : index === threadTraces.data.length - 1
                          ? "last"
                          : "other"
                      }
                      ref={
                        trace.trace_id == traceId ? currentTraceRef : undefined
                      }
                      highlighted={trace.trace_id == modalTraceId}
                    />
                  ))
              ) : threadTraces.error && !isPublicRoute ? (
                <Box maxWidth="800px" paddingTop={8} paddingBottom={4}>
                  <Text color="red.500">
                    Something went wrong trying to load previous messages
                  </Text>
                </Box>
              ) : null
            ) : null}
            {trace.data && !threadTraces.data && (
              <TraceMessages
                trace={trace.data}
                highlighted={!!modalTraceId}
                index="only"
                loadingMore={threadTraces.isFetching}
              />
            )}
            {trace.data && !trace.data.metadata.thread_id && (
              <Box width="full" maxWidth="1000px" paddingY={8}>
                <Text
                  fontStyle="italic"
                  color="gray.500"
                  textAlign="center"
                  width="full"
                >
                  Pass the thread_id on your integration to capture and
                  visualize the whole conversation or associated actions. Read
                  more on our{" "}
                  <Link
                    isExternal
                    href="https://docs.langwatch.ai/integration/python/guide#adding-metadata"
                    textDecoration="underline"
                  >
                    docs
                  </Link>
                  .
                </Text>
              </Box>
            )}
          </>
        ) : trace.isLoading ? (
          <Box maxWidth="1000px" width="full">
            <Grid templateColumns="repeat(4, 1fr)">
              <GridItem colSpan={4}>
                <Box
                  position="relative"
                  border="1px solid"
                  borderColor="gray.200"
                  marginRight={5}
                  paddingLeft={10}
                  paddingRight={10}
                  paddingY={4}
                  background="white"
                  borderRadius="4px"
                  minHeight="524px"
                >
                  <Message
                    author=""
                    avatar={
                      <Skeleton
                        borderRadius="full"
                        minWidth="36px"
                        minHeight="36px"
                      />
                    }
                    paddingTop="20px"
                  >
                    <Box paddingY="6px" marginBottom="62px" maxWidth="90%">
                      <VStack gap={4} width="full" align="start">
                        <Skeleton width="720px" maxWidth="100%" height="20px" />
                        <Skeleton width="720px" maxWidth="100%" height="20px" />
                      </VStack>
                    </Box>
                  </Message>
                  <Message
                    author=""
                    avatar={
                      <Skeleton
                        borderRadius="full"
                        minWidth="36px"
                        minHeight="36px"
                      />
                    }
                  >
                    <Box paddingY="6px" marginBottom="62px" maxWidth="90%">
                      <VStack gap={4} width="full" align="start">
                        <Skeleton width="720px" maxWidth="100%" height="20px" />
                        <Skeleton width="720px" maxWidth="100%" height="20px" />
                      </VStack>
                    </Box>
                  </Message>
                </Box>
              </GridItem>
            </Grid>
          </Box>
        ) : null}
      </VStack>
    </Box>
  );
}
