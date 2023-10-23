import {
  Alert,
  AlertIcon,
  Box,
  Card,
  CardBody,
  Checkbox,
  Container,
  HStack,
  Input,
  Skeleton,
  Spacer,
  Tag,
  VStack,
  Text,
} from "@chakra-ui/react";
import { Check, CheckCircle, Filter, Maximize2, Search } from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { Trace } from "../../server/tracer/types";
import Markdown from "react-markdown";
import { formatDistanceToNow } from "date-fns";
import { formatMilliseconds } from "../../utils/formatMilliseconds";

export default function Messages() {
  const { project } = useOrganizationTeamProject();
  const traces = api.traces.getTraces.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const Message = ({ trace }: { trace: Trace }) => {
    return (
      <Card
        padding={0}
        cursor="pointer"
        width="full"
        transitionDuration="0.2s"
        transitionTimingFunction="ease-in-out"
        _hover={{
          transform: "scale(1.04)",
        }}
      >
        <Box position="absolute" right={5} top={5}>
          <Maximize2 />
        </Box>
        <CardBody padding={8} width="fill">
          <VStack alignItems="flex-start" spacing={4} width="fill">
            <VStack alignItems="flex-start" spacing={8}>
              <VStack alignItems="flex-start" spacing={2}>
                <Box
                  fontSize={11}
                  color="gray.400"
                  textTransform="uppercase"
                  fontWeight="bold"
                >
                  Input
                </Box>
                <Box fontWeight="bold">
                  {trace.input.value.slice(0, 100)}
                  {trace.input.value.length >= 100 && "..."}
                </Box>
              </VStack>
              <VStack alignItems="flex-start" spacing={2}>
                <Box
                  fontSize={11}
                  color="gray.400"
                  textTransform="uppercase"
                  fontWeight="bold"
                >
                  Generated
                </Box>
                <Box>
                  <Markdown className="markdown">
                    {(trace.output?.value.slice(0, 600) ?? "<empty>") +
                      (trace.output && trace.output.value.length >= 600
                        ? "..."
                        : "")}
                  </Markdown>
                </Box>
              </VStack>
            </VStack>
            <Spacer />
            <HStack width="100%" alignItems="flex-end">
              <VStack gap={4} alignItems="flex-start">
                <HStack spacing={2}>
                  <Tag background="blue.50" color="blue.600">
                    Chatbot
                  </Tag>
                  <Tag background="orange.100" color="orange.600">
                    Small Talk
                  </Tag>
                </HStack>
                <HStack fontSize={12} color="gray.400">
                  <Text>
                    {formatDistanceToNow(
                      new Date(trace.timestamps.started_at),
                      {
                        addSuffix: true,
                      }
                    )}
                  </Text>
                  {(!!trace.metrics.completion_tokens ||
                    !!trace.metrics.prompt_tokens) && (
                    <>
                      <Text>·</Text>
                      <Box>
                        {(trace.metrics.completion_tokens ?? 0) +
                          (trace.metrics.prompt_tokens ?? 0)}{" "}
                        tokens
                        {trace.metrics.tokens_estimated && " (estimated)"}
                      </Box>
                    </>
                  )}
                  {!!trace.metrics.first_token_ms && (
                    <>
                      <Text>·</Text>
                      <Box>
                        {formatMilliseconds(trace.metrics.first_token_ms)} to
                        first token
                      </Box>
                    </>
                  )}
                  {!!trace.metrics.total_time_ms && (
                    <>
                      <Text>·</Text>
                      <Box>
                        {formatMilliseconds(trace.metrics.total_time_ms)} completion time
                      </Box>
                    </>
                  )}
                </HStack>
              </VStack>
              <Spacer />
              <Tag
                variant="outline"
                boxShadow="#DEDEDE 0px 0px 0px 1px inset"
                color="green.600"
                paddingY={1}
                paddingX={2}
              >
                <Box paddingRight={2}>
                  <CheckCircle />
                </Box>
                5/5 checks
              </Tag>
            </HStack>
          </VStack>
        </CardBody>
      </Card>
    );
  };

  const MessageSkeleton = () => {
    return (
      <Card width="full" padding={0}>
        <CardBody padding={8}>
          <VStack alignItems="flex-start" spacing={4}>
            <HStack spacing={12} width="full">
              <Box fontSize={24} fontWeight="bold" width="full">
                <Skeleton width="50%" height="20px" />
              </Box>
            </HStack>
            <VStack gap={4} width="full">
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
            </VStack>
          </VStack>
        </CardBody>
      </Card>
    );
  };

  return (
    <DashboardLayout>
      <VStack
        width="full"
        spacing={0}
        position="sticky"
        top={0}
        background="white"
      >
        <Box position="relative" width="full">
          <Box position="absolute" top={6} left={6}>
            <Search size={16} />
          </Box>
          <Input
            variant="unstyled"
            placeholder={"Search"}
            padding={5}
            paddingLeft={12}
            borderRadius={0}
            borderBottom="1px solid #E5E5E5"
          />
        </Box>
        <HStack
          paddingY={5}
          paddingX={6}
          spacing={12}
          width="full"
          borderBottom="1px solid #E5E5E5"
        >
          <Filter size={24} />
          <Spacer />
          <Checkbox>Inbox Narrator</Checkbox>
          <Checkbox>All models</Checkbox>
          <Checkbox>Last 7 days</Checkbox>
        </HStack>
      </VStack>
      <Container maxWidth="1200" padding={6}>
        <VStack gap={6}>
          {traces.data && traces.data.length > 0 ? (
            traces.data.map((trace) => <Message key={trace.id} trace={trace} />)
          ) : traces.data ? (
            <Alert status="info">
              <AlertIcon />
              No messages found
            </Alert>
          ) : traces.isError ? (
            <Alert status="error">
              <AlertIcon />
              An error has occurred trying to load the messages
            </Alert>
          ) : (
            <>
              <MessageSkeleton />
              <MessageSkeleton />
              <MessageSkeleton />
            </>
          )}
        </VStack>
      </Container>
    </DashboardLayout>
  );
}
