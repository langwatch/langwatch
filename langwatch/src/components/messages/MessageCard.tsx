import {
  Badge,
  Box,
  HStack,
  LinkOverlay,
  Skeleton,
  Spacer,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import { Alert } from "@chakra-ui/react";
import { Tag } from "@chakra-ui/react";
import { Tooltip } from "../ui/tooltip";
import { Popover } from "../ui/popover";
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
import type {
  EvaluationResult,
  Trace,
  ElasticSearchEvaluation,
} from "../../server/tracer/types";
import { api } from "../../utils/api";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { pluralize } from "../../utils/pluralize";
import { getColorForString } from "../../utils/rotatingColors";
import { CheckPassing } from "../CheckPassing";
import { useDrawer } from "../CurrentDrawer";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { EventsCounter } from "./EventsCounter";
import { evaluationPassed } from "../checks/EvaluationStatus";
import { isJson } from "../../utils/isJson";
import {
  isPythonRepr,
  parsePythonInsideJson,
} from "../../utils/parsePythonInsideJson";
import { Markdown } from "../Markdown";
import { RedactedField } from "../ui/RedactedField";

export type TraceWithGuardrail = Trace & {
  lastGuardrail: (EvaluationResult & { name?: string }) | undefined;
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
  checksMap: Record<string, ElasticSearchEvaluation[]> | undefined;
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
      evaluationPassed(check) !== false &&
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
      <Tooltip content={`See more`}>
        <Tag.Root
          variant="outline"
          boxShadow="#DEDEDE 0px 0px 0px 1px inset"
          paddingY={1}
          paddingX={2}
          position="relative"
          zIndex="popover"
          borderRadius="full"
          onClick={() =>
            openDrawer("traceDetails", {
              traceId: trace.trace_id,
              selectedTab: "annotations",
            })
          }
        >
          <Tag.Label>
            <HStack>
              <Edit size={24} />
              <Text>
                {annotations.length} annotation
                {annotations.length > 1 ? "s" : ""}
              </Text>
            </HStack>
          </Tag.Label>
        </Tag.Root>
      </Tooltip>
    );
  };

  const evaluationsPopover = useDisclosure();
  const { openDrawer } = useDrawer();

  const inputIsJson = isJson(trace.input?.value ?? "");
  const inputIsPythonRepr = isPythonRepr(trace.input?.value ?? "");

  return (
    <VStack
      alignItems="flex-start"
      gap={4}
      width="fill"
      onClick={(e) => {
        if (!linkActive) e.preventDefault();
        if (linkActive) {
          openDrawer("traceDetails", {
            traceId: trace.trace_id,
            selectedTab: "messages",
          });
        }
      }}
    >
      <VStack alignItems="flex-start" gap={8}>
        <VStack alignItems="flex-start" gap={2}>
          <Box
            fontSize="11px"
            color="gray.400"
            textTransform="uppercase"
            fontWeight="bold"
          >
            Input
          </Box>
          <Box fontWeight="bold">
            <RedactedField field="input">
              {(inputIsJson || inputIsPythonRepr) ? (
                <MessageCardJsonOutput value={trace.input?.value ?? ""} />
              ) : (
                <Text lineClamp={1} wordBreak="break-all" lineHeight="2.1em">
                  <Markdown className="markdown markdown-without-margin">
                    {getExtractedInput(trace)}
                  </Markdown>
                </Text>
              )}
            </RedactedField>
          </Box>
        </VStack>
        <RedactedField field="output">
          {trace.error && !trace.output?.value ? (
            <VStack alignItems="flex-start" gap={2}>
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
          ) : (
            <VStack alignItems="flex-start" gap={2}>
              <Box
                fontSize="11px"
                color="gray.400"
                textTransform="uppercase"
                fontWeight="bold"
              >
                Generated
              </Box>
              <Box wordBreak="break-all">
                {trace.output?.value &&
                (isJson(trace.output.value) ||
                  isPythonRepr(trace.output.value)) ? (
                  <MessageCardJsonOutput value={trace.output.value} />
                ) : trace.output?.value ? (
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
                    gap={4}
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
                      <Text fontSize="13px">
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
                <Alert.Root status="warning" fontSize="13px">
                  <Alert.Indicator>
                    <CornerDownRight size="16" />
                  </Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title>Expected Output:</Alert.Title>
                    <Text>{getSlicedExpectedOutput(trace)}</Text>
                  </Alert.Content>
                </Alert.Root>
              )}
            </VStack>
          )}
        </RedactedField>
      </VStack>
      <Spacer />
      <HStack width="full" alignItems="flex-end">
        <VStack gap={4} alignItems="flex-start">
          <HStack gap={2}>
            {traceTopic && (
              <Badge
                background={
                  getColorForString("colors", traceTopic.id).background
                }
                color={getColorForString("colors", traceTopic.id).color}
                fontSize="12px"
              >
                {traceTopic.name}
              </Badge>
            )}
            {traceSubtopic && (
              <Badge
                background={
                  getColorForString("colors", traceSubtopic.id).background
                }
                color={getColorForString("colors", traceSubtopic.id).color}
                fontSize="12px"
              >
                {traceSubtopic.name}
              </Badge>
            )}
            {(trace.metadata.labels ?? []).map((label) => (
              <Badge
                key={label}
                background={getColorForString("colors", label).background}
                color={getColorForString("colors", label).color}
                fontSize="12px"
              >
                {label}
              </Badge>
            ))}
          </HStack>
          <HStack fontSize="12px" color="gray.400">
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
              content={new Date(trace.timestamps.started_at).toLocaleString()}
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
            {!!trace.metrics?.total_cost && (
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
            {!!trace.metrics?.first_token_ms && (
              <>
                <Text>·</Text>
                <Box>
                  {formatMilliseconds(trace.metrics.first_token_ms)} to first
                  token
                </Box>
              </>
            )}
            {!!trace.metrics?.total_time_ms && (
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
          <Popover.Root>
            <Popover.Trigger>
              <Tag.Root
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
                borderRadius="full"
              >
                <Tag.Label>
                  <HStack gap={2}>
                    {allGuardrailsSkipped ? (
                      <>
                        <Box>
                          <MinusCircle />
                        </Box>
                        Guardrails skipped
                      </>
                    ) : guardrailsPasses == totalGuardrails ? (
                      <>
                        <Box>
                          <CheckCircle />
                        </Box>
                        {guardrailsPasses}/{totalGuardrails} guardrails
                      </>
                    ) : (
                      <>
                        <Box>
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
                  </HStack>
                </Tag.Label>
              </Tag.Root>
            </Popover.Trigger>
            <Popover.Content>
              <Popover.Header>Guardrails</Popover.Header>
              <Popover.Body>
                <VStack align="start" gap={2}>
                  {guardrails.map((evaluation) => (
                    <CheckPassing
                      key={evaluation.evaluation_id}
                      check={evaluation}
                    />
                  ))}
                </VStack>
              </Popover.Body>
            </Popover.Content>
          </Popover.Root>
        )}
        {checksMap && totalEvaluations > 0 && (
          <Popover.Root
            open={evaluationsPopover.open}
            onOpenChange={({ open }) => evaluationsPopover.setOpen(open)}
          >
            <Popover.Trigger>
              <Tag.Root
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
                borderRadius="full"
                onMouseEnter={evaluationsPopover.onOpen}
                onMouseLeave={evaluationsPopover.onClose}
              >
                <Tag.Label>
                  <HStack gap={2}>
                    {!evaluationsDone ? (
                      <Clock />
                    ) : allEvaluationsSkipped ? (
                      <MinusCircle />
                    ) : evaluationsPasses == totalEvaluations ? (
                      <CheckCircle />
                    ) : (
                      <XCircle />
                    )}
                    {allEvaluationsSkipped
                      ? "Evaluations skipped"
                      : evaluationsDone && evaluationsPasses != totalEvaluations
                      ? `${totalEvaluations - evaluationsPasses} ${
                          totalEvaluations - evaluationsPasses == 1
                            ? "evaluation failed"
                            : "evaluations failed"
                        }`
                      : `${evaluationsPasses}/${totalEvaluations} evaluations`}
                  </HStack>
                </Tag.Label>
              </Tag.Root>
            </Popover.Trigger>
            <Popover.Content width="500px">
              <Popover.Arrow />
              <Popover.Header>Evaluations</Popover.Header>
              <Popover.Body>
                <VStack align="start" gap={2}>
                  {evaluations.map((evaluation) => (
                    <CheckPassing
                      key={evaluation.evaluation_id}
                      check={evaluation}
                    />
                  ))}
                </VStack>
              </Popover.Body>
            </Popover.Content>
          </Popover.Root>
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

export function MessageCardJsonOutput({ value }: { value: string }) {
  const json = JSON.stringify(
    parsePythonInsideJson(isPythonRepr(value) ? value : JSON.parse(value)),
    null,
    2
  );

  return (
    <Text
      as="pre"
      fontFamily="mono"
      fontSize="14px"
      width="full"
      whiteSpace="pre-wrap"
    >
      {json.slice(0, 250) + (json.length > 250 ? "..." : "")}
    </Text>
  );
}
