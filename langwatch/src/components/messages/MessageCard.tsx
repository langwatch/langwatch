import {
  Box,
  HStack,
  LinkOverlay,
  Popover,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
  Portal,
  Skeleton,
  Spacer,
  Tag,
  Text,
  Tooltip,
  VStack
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import { formatDistanceToNow } from "date-fns";
import NextLink from "next/link";
import numeral from "numeral";
import { CheckCircle, Clock, Shield, XCircle } from "react-feather";
import Markdown from "react-markdown";
import type {
  GuardrailResult,
  Trace,
  TraceCheck,
} from "../../server/tracer/types";
import { api } from "../../utils/api";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { getColorForString } from "../../utils/rotatingColors";
import { CheckPassing } from "../CheckPassing";

export type TraceWithGuardrail = Trace & {
  lastGuardrail: (GuardrailResult & { name?: string }) | undefined;
};

export function MessageCard({
  linkActive,
  project,
  trace,
  checksMap,
}: {
  linkActive: boolean;
  project: Project;
  trace: TraceWithGuardrail;
  checksMap: Record<string, TraceCheck[]> | undefined;
}) {
  const traceChecks = checksMap ? checksMap[trace.trace_id] ?? [] : [];
  const checksDone = traceChecks.every(
    (check) =>
      check.status == "processed" ||
      check.status == "skipped" ||
      check.status == "error"
  );
  const checkPasses = traceChecks.filter(
    (check) =>
      check.passed !== false &&
      (check.status === "processed" || check.status === "skipped")
  ).length;

  const totalChecks = traceChecks.length;

  const topics = api.topics.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnMount: false, refetchOnWindowFocus: false }
  );
  const topicsMap = Object.fromEntries(
    topics.data?.map((topic) => [topic.id, topic]) ?? []
  );
  const traceTopic = topicsMap[trace.metadata.topic_id ?? ""];
  const traceSubtopic = topicsMap[trace.metadata.subtopic_id ?? ""];

  return (
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
            <LinkOverlay
              as={NextLink}
              href={`/${project.slug}/messages/${trace.trace_id}/spans`}
              onClick={(e) => {
                if (!linkActive) e.preventDefault();
              }}
            >
              <Text noOfLines={1} wordBreak="break-all">
                {getExtractedInput(trace)}
              </Text>
            </LinkOverlay>
          </Box>
        </VStack>
        {trace.error && !trace.output?.value ? (
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
              ) : trace.lastGuardrail ? (
                <HStack
                  align="start"
                  border="1px solid"
                  borderColor="gray.300"
                  borderRadius={6}
                  padding={4}
                  spacing={4}
                >
                  <HStack>
                    <Box
                      color="green.700"
                      background="green.100"
                      borderRadius="100%"
                      padding="6px"
                    >
                      <Shield size="26px" />
                    </Box>
                  </HStack>
                  <VStack align="start">
                    <Text>Blocked by Guardrail</Text>
                    <Text fontSize={13}>
                      {trace.lastGuardrail.details
                        ? trace.lastGuardrail.details
                        : trace.lastGuardrail.name}
                    </Text>
                  </VStack>
                </HStack>
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
            {traceTopic && (
              <Tag
                background={
                  getColorForString("colors", traceTopic.id).background
                }
                color={getColorForString("colors", traceTopic.id).color}
                fontSize={12}
              >
                {traceTopic.name}
              </Tag>
            )}
            {traceSubtopic && (
              <Tag
                background={
                  getColorForString("colors", traceSubtopic.id).background
                }
                color={getColorForString("colors", traceSubtopic.id).color}
                fontSize={12}
              >
                {traceSubtopic.name}
              </Tag>
            )}
            {(trace.metadata.labels ?? []).map((label) => (
              <Tag
                key={label}
                background={getColorForString("colors", label).background}
                color={getColorForString("colors", label).color}
                fontSize={12}
              >
                {label}
              </Tag>
            ))}
          </HStack>
          <HStack fontSize={12} color="gray.400">
            {!!trace.metadata.customer_id && (
              <>
                <Box>
                  Customer ID:{" "}
                  {trace.metadata.customer_id.substring(0, 16) +
                    (trace.metadata.customer_id.length > 16 ? "..." : "")}
                </Box>
                <Text>·</Text>
              </>
            )}
            <Tooltip
              label={new Date(trace.timestamps.started_at).toLocaleString()}
            >
              <Text
                borderBottomWidth="1px"
                borderBottomColor="gray.400"
                borderBottomStyle="dashed"
              >
                {formatDistanceToNow(new Date(trace.timestamps.started_at), {
                  addSuffix: true,
                })}
              </Text>
            </Tooltip>
            {!!trace.metrics.total_cost && (
              <>
                <Text>·</Text>
                <Box>
                  {trace.metrics.total_cost > 0.01
                    ? numeral(trace.metrics.total_cost).format("$0.00a")
                    : "< $0.01"}{" "}
                  cost
                </Box>
              </>
            )}
            {!!trace.metrics.first_token_ms && (
              <>
                <Text>·</Text>
                <Box>
                  {formatMilliseconds(trace.metrics.first_token_ms)} to first
                  token
                </Box>
              </>
            )}
            {!!trace.metrics.total_time_ms && (
              <>
                <Text>·</Text>
                <Box>
                  {formatMilliseconds(trace.metrics.total_time_ms)} completion
                  time
                </Box>
              </>
            )}
            {!!trace.error && trace.output?.value && (
              <>
                <Text>·</Text>
                <HStack>
                  <Box
                    width={2}
                    height={2}
                    background="red.400"
                    borderRadius="100%"
                  ></Box>
                  <Text>Exception ocurred</Text>
                </HStack>
              </>
            )}
          </HStack>
        </VStack>
        <Spacer />
        {!checksMap && <Skeleton width={100} height="1em" />}
        {checksMap && totalChecks > 0 && (
          <Popover trigger="hover">
            <PopoverTrigger>
              <Tag
                variant="outline"
                boxShadow="#DEDEDE 0px 0px 0px 1px inset"
                color={
                  !checksDone
                    ? "yellow.600"
                    : checkPasses == totalChecks
                    ? "green.600"
                    : "red.600"
                }
                paddingY={1}
                paddingX={2}
                position="relative"
                zIndex="popover"
              >
                <Box paddingRight={2}>
                  {!checksDone ? (
                    <Clock />
                  ) : checkPasses == totalChecks ? (
                    <CheckCircle />
                  ) : (
                    <XCircle />
                  )}
                </Box>
                {checkPasses}/{totalChecks} evaluations
              </Tag>
            </PopoverTrigger>
            <Portal>
              <Box zIndex="popover">
                <PopoverContent zIndex={2} width="fit-content">
                  <PopoverArrow />
                  <PopoverHeader>Evaluations</PopoverHeader>
                  <PopoverBody>
                    <VStack align="start" spacing={2}>
                      {traceChecks.map((check) => (
                        <CheckPassing
                          key={check.trace_id + "/" + check.check_id}
                          check={check}
                        />
                      ))}
                    </VStack>
                  </PopoverBody>
                </PopoverContent>
              </Box>
            </Portal>
          </Popover>
        )}
      </HStack>
    </VStack>
  );
}

export const getExtractedInput = (trace: Trace) => {
  const input = trace.input;

  let value = input.value;
  try {
    const json: any = JSON.parse(value);
    if (
      "input" in json &&
      typeof json.input === "string" &&
      json.input.length > 0
    ) {
      value = json.input;
    }
  } catch {
    // ignore
  }

  return value ? value : "<empty>";
};

const getSlicedOutput = (trace: Trace) => {
  const value = trace.output?.value.slice(0, 600);

  return (
    (value ? value : "<empty>") +
    (trace.output && trace.output.value.length >= 600 ? "..." : "")
  );
};
