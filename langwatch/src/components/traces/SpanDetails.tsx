import {
  Badge,
  Box,
  HStack,
  Heading,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Project } from "@prisma/client";
import numeral from "numeral";
import { Clock, Settings } from "react-feather";
import type {
  ElasticSearchSpan,
  ErrorCapture,
  EvaluationResult,
  Span,
} from "../../server/tracer/types";
import { durationColor } from "../../utils/durationColor";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import {
  evaluationPassed,
  evaluationStatusColor,
} from "../checks/EvaluationStatus";
import { Link } from "../ui/link";
import { Tooltip } from "../ui/tooltip";
import { RenderInputOutput } from "./RenderInputOutput";
import { OverflownTextWithTooltip } from "../OverflownText";
import { RedactedField } from "../ui/RedactedField";

export function SpanDetails({
  project,
  span,
}: {
  project: Project;
  span: Span;
}) {
  const estimatedCost = (
    <Tooltip content="When `metrics.completion_tokens` and `metrics.prompt_tokens` are not available, they are estimated based on input, output and the model for calculating costs.">
      <Text as="span" color="gray.400" borderBottom="1px dotted">
        {" (estimated)"}
      </Text>
    </Tooltip>
  );

  return (
    <VStack flexGrow={1} gap={3} align="start">
      <HStack width="full">
        <SpanTypeTag span={span} />
        <Heading as="h2" fontSize="22px" asChild>
          <OverflownTextWithTooltip lineClamp={1} wordBreak="break-word">
            {span.name ?? ('model' in span ? span.model : "(unnamed)")}
          </OverflownTextWithTooltip>
        </Heading>
        <Spacer />
      </HStack>
      <VStack align="start" color="gray.500">
        <HStack>
          <Text>
            <b>Span ID:</b> <Text as="code">{span.span_id}</Text>
          </Text>
        </HStack>
        <HStack>
          <Text>
            <b>Timestamp:</b>{" "}
            {new Date(span.timestamps.started_at).toISOString()}
          </Text>
        </HStack>
        {span.timestamps.first_token_at && (
          <HStack>
            <Text>
              <b>Time to first token:</b>{" "}
            </Text>
            <SpanDuration span={span} renderFirstTokenDuration />
          </HStack>
        )}
        <HStack>
          <Text>
            <b>Duration:</b>
          </Text>
          <SpanDuration span={span} />
        </HStack>
        {(span.metrics?.prompt_tokens !== undefined ||
          span.metrics?.completion_tokens !== undefined) && (
          <Text>
            <b>Tokens:</b>{" "}
            {(span.metrics?.prompt_tokens ?? 0) +
              " prompt + " +
              (span.metrics?.completion_tokens ?? 0) +
              " completion"}
            {span.metrics.completion_tokens &&
              span.metrics.completion_tokens > 0 &&
              (() => {
                const durationFromFirstToken =
                  span.timestamps.finished_at -
                  (span.timestamps.first_token_at ??
                    span.timestamps.started_at);
                return ` (${Math.round(
                  span.metrics.completion_tokens /
                    (durationFromFirstToken / 1000)
                )} tokens/s)`;
              })()}
            {span.metrics?.tokens_estimated && estimatedCost}
          </Text>
        )}
        {('vendor' in span || 'model' in span) && (
          <Text>
            <b>Model:</b> {[span.vendor, span.model].filter((x) => x).join("/")}
          </Text>
        )}
        {span.metrics?.cost !== undefined && (
          <HStack>
            <Text>
              <b>Cost:</b> {numeral(span.metrics.cost).format("$0.00000a")}
              {span.metrics?.tokens_estimated && estimatedCost}
            </Text>
            <Tooltip content="Edit model costs">
              <Link target="_blank" href={`/settings/model-costs`}>
                <Settings size={14} />
              </Link>
            </Tooltip>
          </HStack>
        )}
      </VStack>
      {span.params && (
        <VStack alignItems="flex-start" gap={2} paddingTop={4} width="full">
          <Box
            fontSize="13px"
            color="gray.400"
            textTransform="uppercase"
            fontWeight="bold"
          >
            Params
          </Box>
          <Box
            as="pre"
            borderRadius="6px"
            padding={4}
            borderWidth="1px"
            borderColor="gray.300"
            width="full"
            whiteSpace="pre-wrap"
          >
            <RenderInputOutput
              value={JSON.stringify(
                Object.fromEntries(
                  Object.entries(span.params).filter(([key]) => key !== "_keys")
                )
              )}
              collapsed={
                (!!span.input || !!span.output) &&
                JSON.stringify(span.params).length > 100
              }
              showTools
            />
          </Box>
        </VStack>
      )}
      {span.input && (
        <VStack alignItems="flex-start" gap={2} paddingTop={4} width="full">
          <Box
            fontSize="13px"
            color="gray.400"
            textTransform="uppercase"
            fontWeight="bold"
          >
            Input
          </Box>
          <Box
            as="pre"
            borderRadius="6px"
            padding={4}
            borderWidth="1px"
            borderColor="gray.300"
            width="full"
            whiteSpace="pre-wrap"
          >
            <RedactedField field="input">
              <RenderInputOutput value={span.input?.value} showTools />
            </RedactedField>
          </Box>
        </VStack>
      )}
      {('contexts' in span && span.contexts) && (
        <VStack alignItems="flex-start" gap={2} paddingTop={4} width="full">
          <Box
            fontSize="13px"
            color="gray.400"
            textTransform="uppercase"
            fontWeight="bold"
          >
            Contexts
          </Box>
          <Box
            as="pre"
            borderRadius="6px"
            padding={4}
            borderWidth="1px"
            borderColor="gray.300"
            width="full"
            whiteSpace="pre-wrap"
          >
            <RenderInputOutput
              value={JSON.stringify(
                span.contexts.map((context) => {
                  if (typeof context.content === "string") {
                    try {
                      return {
                        ...context,
                        content: JSON.parse(context.content),
                      };
                    } catch (_) {
                      return context;
                    }
                  }
                  return context;
                })
              )}
              showTools
            />
          </Box>
        </VStack>
      )}
      {span.error ? (
        <VStack alignItems="flex-start" gap={2} paddingTop={4} width="full">
          <Box
            fontSize="13px"
            color="red.400"
            textTransform="uppercase"
            fontWeight="bold"
          >
            Exception
          </Box>
          <Box
            as="pre"
            borderRadius="6px"
            padding={4}
            borderWidth="1px"
            borderColor="gray.300"
            width="full"
            whiteSpace="pre-wrap"
            color="red.900"
          >
            {span.error.stacktrace}
          </Box>
        </VStack>
      ) : (
        span.output !== undefined &&
        span.output !== null && (
          <VStack alignItems="flex-start" gap={2} paddingTop={4} width="full">
            <Box
              fontSize="13px"
              color="gray.400"
              textTransform="uppercase"
              fontWeight="bold"
            >
              {span.type === "llm" ? "Generated" : "Output"}
            </Box>
            {!span.output && <Text>{"<empty>"}</Text>}
            {span.output && (
              <Box
                as="pre"
                borderRadius="6px"
                padding={4}
                borderWidth="1px"
                borderColor="gray.300"
                width="full"
                whiteSpace="pre-wrap"
              >
                <RedactedField field="output">
                  <RenderInputOutput value={span.output.value} showTools />
                </RedactedField>
              </Box>
            )}
          </VStack>
        )
      )}
    </VStack>
  );
}

export const getEvaluationResult = (
  span: Span
): EvaluationResult | undefined => {
  if (!span.output?.value) {
    return undefined;
  }

  if (span.output.type === "evaluation_result") {
    try {
      if (typeof span.output.value === "string") {
        return JSON.parse(span.output.value);
      }

      return span.output.value;
    } catch (_) {
      return undefined;
    }
  }
  return undefined;
};

export const SpanTypeTag = ({ span }: { span: Span }) => {
  const evaluationResult = getEvaluationResult(span);
  const evaluationPassed_ =
    evaluationResult && evaluationPassed(evaluationResult);

  return (
    <Badge
      colorPalette={
        span.error
          ? "red"
          : {
              llm: "green",
              agent: "blue",
              chain: "blue",
              tool: "orange",
              span: "gray",
              rag: "red",
              guardrail: "blue",
              component: "gray",
              module: "gray",
              workflow: "purple",
              server: "blue",
              client: "green",
              producer: "red",
              consumer: "green",
              task: "orange",
              unknown: "gray",
              evaluation:
                evaluationPassed_ === undefined
                  ? evaluationResult
                    ? evaluationStatusColor(evaluationResult).split(".")[0]
                    : "gray"
                  : evaluationPassed_
                  ? "green"
                  : "red",
            }[span.type]
      }
      backgroundColor={evaluationPassed_ === true ? "#ccf6c6" : undefined}
      fontSize="12px"
    >
      {span.type.toUpperCase()}
    </Badge>
  );
};

export const SpanDuration = ({
  span,
  renderFirstTokenDuration = false,
}: {
  span: {
    error?: ErrorCapture | string | null;
    timestamps: {
      started_at: number;
      first_token_at?: number | null;
      finished_at: number;
    };
  };
  renderFirstTokenDuration?: boolean;
}) => {
  const startedAt = span.timestamps.started_at;
  const finishedAt = renderFirstTokenDuration
    ? span.timestamps.first_token_at ?? startedAt
    : span.timestamps.finished_at;
  const duration = finishedAt - startedAt;

  return (
    <Tooltip
      content={
        <>
          Started at: {new Date(startedAt).toLocaleString()}
          <br />
          {renderFirstTokenDuration ? "First token at" : "Finished at"}:{" "}
          {new Date(finishedAt).toLocaleString()}
        </>
      }
    >
      <HStack
        gap={"6px"}
        color={span.error ? "red" : durationColor("span", duration)}
      >
        <Clock width={12} />
        <Text>{formatMilliseconds(duration)}</Text>
      </HStack>
    </Tooltip>
  );
};
