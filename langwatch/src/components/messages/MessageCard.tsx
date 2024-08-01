import {
  Alert,
  AlertTitle,
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
  VStack,
} from "@chakra-ui/react";
import type { Annotation, Project } from "@prisma/client";
import NextLink from "next/link";
import numeral from "numeral";
import {
  CheckCircle,
  Clock,
  CornerDownRight,
  Edit,
  MinusCircle,
  Shield,
  XCircle,
} from "react-feather";
import Markdown from "react-markdown";
import type {
  GuardrailResult,
  Trace,
  TraceCheck,
} from "../../server/tracer/types";
import { api } from "../../utils/api";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { pluralize } from "../../utils/pluralize";
import { getColorForString } from "../../utils/rotatingColors";
import { CheckPassing } from "../CheckPassing";
import { useDrawer } from "../CurrentDrawer";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { EventsCounter } from "./EventsCounter";

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
  const evaluations = checksMap
    ? checksMap[trace.trace_id]?.filter((x) => !x.is_guardrail) ?? []
    : [];
  const guardrails = checksMap
    ? checksMap[trace.trace_id]?.filter((x) => x.is_guardrail) ?? []
    : [];
  const evaluationsDone = evaluations.every(
    (check) =>
      check.status == "processed" ||
      check.status == "skipped" ||
      check.status == "error"
  );
  const evaluationsPasses = evaluations.filter(
    (check) =>
      check.passed !== false &&
      (check.status === "processed" || check.status === "skipped")
  ).length;
  const guardrailsPasses = guardrails.filter(
    (check) => check.passed !== false
  ).length;

  const allEvaluationsSkipped = evaluations.every(
    (check) => check.status === "skipped"
  );
  const allGuardrailsSkipped = guardrails.every(
    (check) => check.status === "skipped"
  );

  const totalEvaluations = evaluations.length;
  const totalGuardrails = guardrails.length;

  const topics = api.topics.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchOnMount: false, refetchOnWindowFocus: false }
  );
  const topicsMap = Object.fromEntries(
    topics.data?.map((topic) => [topic.id, topic]) ?? []
  );
  const traceTopic = topicsMap[trace.metadata.topic_id ?? ""];
  const traceSubtopic = topicsMap[trace.metadata.subtopic_id ?? ""];

  const annotations = api.annotation.getByTraceId.useQuery({
    traceId: trace.trace_id,
    projectId: project.id,
  });

  const Annotation = ({ annotations }: { annotations: Annotation[] }) => {
    const { openDrawer } = useDrawer();

    return (
      <Tooltip label={`${annotations.length} Annotations`}>
        <Box
          right={2}
          top={2}
          borderRadius="2xl"
          borderWidth={1}
          borderColor="gray.300"
          paddingY={1}
          paddingX={2}
          zIndex="99"
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
              annotationTab: true,
            })
          }
        >
          <HStack>
            <Edit size="20px" />
            <Text fontSize="sm">
              {annotations.length} annotation{annotations.length > 1 ? "s" : ""}
            </Text>
          </HStack>
        </Box>
      </Tooltip>
    );
  };

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
            <Box wordBreak="break-all">
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
                      color="blue.700"
                      background="blue.100"
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
            {trace.expected_output && (
              <Alert status="warning" fontSize={13}>
                <Box paddingRight={2}>
                  <CornerDownRight size="16" />
                </Box>
                <AlertTitle>Expected Output:</AlertTitle>
                <Text>{getSlicedExpectedOutput(trace)}</Text>
              </Alert>
            )}
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
                position="relative"
                zIndex="popover"
              >
                {formatTimeAgo(trace.timestamps.started_at)}
              </Text>
            </Tooltip>
            <EventsCounter trace={trace} />
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
        {annotations.data && annotations.data.length > 0 && (
          <Annotation annotations={annotations.data} />
        )}
        {!checksMap && <Skeleton width={100} height="1em" />}
        {checksMap && totalGuardrails > 0 && (
          <Popover trigger="hover">
            <PopoverTrigger>
              <Tag
                variant="outline"
                boxShadow="#DEDEDE 0px 0px 0px 1px inset"
                color={
                  allGuardrailsSkipped
                    ? "yellow.600"
                    : guardrailsPasses == totalGuardrails
                    ? "green.600"
                    : "blue.600"
                }
                paddingY={1}
                paddingX={2}
                position="relative"
                zIndex="popover"
              >
                {allGuardrailsSkipped ? (
                  <>
                    <Box paddingRight={2}>
                      <MinusCircle />
                    </Box>
                    Guardrails skipped
                  </>
                ) : guardrailsPasses == totalGuardrails ? (
                  <>
                    <Box paddingRight={2}>
                      <CheckCircle />
                    </Box>
                    {guardrailsPasses}/{totalGuardrails} guardrails
                  </>
                ) : (
                  <>
                    <Box paddingRight={2}>
                      <Shield />
                    </Box>
                    {totalGuardrails - guardrailsPasses}{" "}
                    {pluralize(
                      totalGuardrails - guardrailsPasses,
                      "guardrail block",
                      "guardrail blocks"
                    )}
                  </>
                )}
              </Tag>
            </PopoverTrigger>
            <Portal>
              <Box zIndex="popover">
                <PopoverContent zIndex={2} width="fit-content">
                  <PopoverArrow />
                  <PopoverHeader>Guardrails</PopoverHeader>
                  <PopoverBody>
                    <VStack align="start" spacing={2}>
                      {guardrails.map((check) => (
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
        {checksMap && totalEvaluations > 0 && (
          <Popover trigger="hover">
            <PopoverTrigger>
              <Tag
                variant="outline"
                boxShadow="#DEDEDE 0px 0px 0px 1px inset"
                color={
                  !evaluationsDone || allEvaluationsSkipped
                    ? "yellow.600"
                    : evaluationsPasses == totalEvaluations
                    ? "green.600"
                    : "red.600"
                }
                paddingY={1}
                paddingX={2}
                position="relative"
                zIndex="popover"
              >
                <Box paddingRight={2}>
                  {!evaluationsDone ? (
                    <Clock />
                  ) : allEvaluationsSkipped ? (
                    <MinusCircle />
                  ) : evaluationsPasses == totalEvaluations ? (
                    <CheckCircle />
                  ) : (
                    <XCircle />
                  )}
                </Box>
                {allEvaluationsSkipped
                  ? "Evaluations skipped"
                  : evaluationsDone && evaluationsPasses != totalEvaluations
                  ? `${totalEvaluations - evaluationsPasses} ${
                      totalEvaluations - evaluationsPasses == 1
                        ? "evaluation failed"
                        : "evaluations failed"
                    }`
                  : `${evaluationsPasses}/${totalEvaluations} evaluations`}
              </Tag>
            </PopoverTrigger>
            <Portal>
              <Box zIndex="popover">
                <PopoverContent zIndex={2} width="fit-content">
                  <PopoverArrow />
                  <PopoverHeader>Evaluations</PopoverHeader>
                  <PopoverBody>
                    <VStack align="start" spacing={2}>
                      {evaluations.map((check) => (
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

  let value = input?.value ?? "";
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

export const getSlicedExpectedOutput = (trace: Trace) => {
  const value = trace.expected_output?.value.slice(0, 600);

  return (
    (value ? value : "<empty>") +
    (trace.output && trace.output.value.length >= 600 ? "..." : "")
  );
};
