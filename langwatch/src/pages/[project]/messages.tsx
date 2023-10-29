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
  Tooltip,
} from "@chakra-ui/react";
import {
  Check,
  CheckCircle,
  Filter,
  HelpCircle,
  Maximize2,
  Search,
} from "react-feather";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import {
  getSlicedInput,
  getSlicedOutput,
  getTotalTokensDisplay,
} from "~/mappers/trace";
import Markdown from "react-markdown";
import { formatDistanceToNow } from "date-fns";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { Link } from "@chakra-ui/next-js";
import type { Trace } from "../../server/tracer/types";

export default function Messages() {
  const { project } = useOrganizationTeamProject();
  const traces = api.traces.getAllForProject.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const Message = ({ trace }: { trace: Trace }) => {
    return (
      <Link
        width="full"
        href={`/${project?.slug}/messages/${trace.id}`}
        _hover={{ textDecoration: "none" }}
      >
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
                  <Box fontWeight="bold">{getSlicedInput(trace)}</Box>
                </VStack>
                {trace.error ? (
                  <VStack alignItems="flex-start" spacing={2}>
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
                ) : (
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
                      {trace.output?.value ? (
                        <Markdown className="markdown">
                          {getSlicedOutput(trace)}
                        </Markdown>
                      ) : (
                        <Text>{"<empty>"}</Text>
                      )}
                    </Box>
                  </VStack>
                )}
              </VStack>
              <Spacer />
              <HStack width="full" alignItems="flex-end">
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
                    <Tooltip
                      label={new Date(
                        trace.timestamps.started_at
                      ).toLocaleString()}
                    >
                      <Text
                        borderBottomWidth="1px"
                        borderBottomColor="gray.300"
                        borderBottomStyle="dashed"
                      >
                        {formatDistanceToNow(
                          new Date(trace.timestamps.started_at),
                          {
                            addSuffix: true,
                          }
                        )}
                      </Text>
                    </Tooltip>
                    {(!!trace.metrics.completion_tokens ||
                      !!trace.metrics.prompt_tokens) && (
                      <>
                        <Text>·</Text>
                        <HStack>
                          <Box>{getTotalTokensDisplay(trace)}</Box>
                          {trace.metrics.tokens_estimated && (
                            <Tooltip label="token count is calculated by LangWatch when not available from the trace data">
                              <HelpCircle width="14px" />
                            </Tooltip>
                          )}
                        </HStack>
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
                          {formatMilliseconds(trace.metrics.total_time_ms)}{" "}
                          completion time
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
      </Link>
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
        zIndex={1}
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
