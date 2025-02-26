import { Box, Heading, HStack, Text, VStack } from "@chakra-ui/react";
import ErrorPage from "next/error";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import { DashboardLayout } from "../../../../components/DashboardLayout";
import { useTraceDetailsState } from "../../../../hooks/useTraceDetailsState";
import { isNotFound } from "../../../../utils/trpcError";

import { Conversation } from "../../../../components/messages/Conversation";

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
    <DashboardLayout backgroundColor="gray.100">
      <VStack
        maxWidth="1600"
        paddingY={6}
        paddingX={12}
        alignSelf="flex-start"
        alignItems="flex-start"
        width="full"
        gap={10}
      >
        <VStack gap={6} alignItems="flex-start" width="full">
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
        width="100%"
        maxWidth="1600"
        marginBottom="48px"
      >
        <HStack
          align="start"
          width="full"
          gap={0}
          alignItems="stretch"
          height="100%"
        >
          <Conversation threadId={threadId} traceId={traceId} />
        </HStack>
      </Box>
    </DashboardLayout>
  );
}
