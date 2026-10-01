import { Link } from "@langwatch/browser-host/link";
import { formatMilliseconds } from "@langwatch/design-system/format-milliseconds";
import { Menu } from "@langwatch/design-system/menu";
import {
  Badge,
  Box,
  Button,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { evaluationPassed, evaluationStatusColor } from "@langwatch/evaluator-browser-kit";
import {
  findPromptReferenceInAncestors,
  flattenParamsToPromptAttributes,
  type PromptLookupSpan,
} from "@langwatch/prompt-contract";
import { Temporal, toDate } from "@langwatch/time";
import {
  type ErrorCapture,
  type EvaluationResult,
  evaluationResultSchema,
  type Span,
} from "@langwatch/trace-contract";
import numeral from "numeral";
import { useMemo } from "react";
import { ChevronDown, Clock, Play, Settings } from "react-feather";

import { useGoToSpanInPlaygroundTabUrlBuilder } from "../../../behavior/prompts/use-load-span-into-prompt-playground.ts";
import { durationColor } from "../../../model/duration-color.ts";
import type { Project } from "../../../model/prisma-types.ts";
import { OverflownTextWithTooltip } from "../../elements/overflown-text.tsx";
import { RedactedField } from "../redacted-field.tsx";
import { RenderInputOutput } from "./render-input-output.tsx";

/** A prompt reference, `handle:version` or `handle:tag`, from the span or its relatives. */
function promptRefFor({ span, allSpans }: { span: Span; allSpans?: Span[] }): string | null {
  const ownAttrs = flattenParamsToPromptAttributes(span.params as Record<string, unknown> | null);
  const promptId = ownAttrs["langwatch.prompt.id"];
  if (typeof promptId === "string" && promptId.includes(":")) return promptId;
  if (!allSpans) return null;
  const ref = findPromptReferenceInAncestors({
    targetSpanId: span.span_id,
    spans: allSpans.map((s): PromptLookupSpan => ({
      spanId: s.span_id,
      parentSpanId: s.parent_id ?? null,
      startTime: s.timestamps.started_at,
      attributes: flattenParamsToPromptAttributes(s.params as Record<string, unknown> | null),
    })),
  });
  if (!ref?.promptHandle || (ref.promptVersionNumber == null && !ref.promptTag)) return null;
  return `${ref.promptHandle}:${ref.promptTag ?? String(ref.promptVersionNumber)}`;
}

/** A context whose string content is JSON reads as the parsed value. */
function withParsedContent<C extends { content: unknown }>(context: C): C {
  if (typeof context.content !== "string") return context;
  try {
    return { ...context, content: JSON.parse(context.content) };
  } catch {
    return context;
  }
}

/** Tokens per second from the first token (or the start) to the finish. */
function tokensPerSecond(span: Span): number {
  const completion = span.metrics?.completion_tokens ?? 0;
  const from = span.timestamps.first_token_at ?? span.timestamps.started_at;
  return Math.round(completion / ((span.timestamps.finished_at - from) / 1000));
}

function positiveNote(count: number | null | undefined, label: string): string {
  return count != null && count > 0 ? ` (${count} ${label})` : "";
}

function TokensLine({ span, estimatedCost }: { span: Span; estimatedCost: React.ReactNode }) {
  const metrics = span.metrics;
  return (
    <Text>
      <b>Tokens:</b>{" "}
      {`${metrics?.prompt_tokens ?? 0} prompt + ${metrics?.completion_tokens ?? 0} completion`}
      {positiveNote(metrics?.reasoning_tokens, "reasoning")}
      {positiveNote(metrics?.cache_read_input_tokens, "cache read")}
      {positiveNote(metrics?.cache_creation_input_tokens, "cache write")}
      {!!metrics?.completion_tokens && ` (${tokensPerSecond(span)} tokens/s)`}
      {metrics?.tokens_estimated && estimatedCost}
    </Text>
  );
}

function SpanSection({
  label,
  color = "fg.subtle",
  children,
}: {
  label: string;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <VStack alignItems="flex-start" gap={2} paddingTop={4} width="full">
      <Box fontSize="13px" color={color} textTransform="uppercase" fontWeight="bold">
        {label}
      </Box>
      {children}
    </VStack>
  );
}

function PreBox({ background, children }: { background?: string; children: React.ReactNode }) {
  return (
    <Box
      as="pre"
      borderRadius="6px"
      padding={4}
      borderWidth="1px"
      borderColor="border.emphasized"
      width="full"
      whiteSpace="pre-wrap"
      background={background}
    >
      {children}
    </Box>
  );
}

function SpanException({ error }: { error: ErrorCapture }) {
  const hasStacktrace = !!error.stacktrace?.length;
  return (
    <SpanSection label="Exception" color="red.fg">
      <Box
        as="pre"
        borderRadius="6px"
        padding={4}
        borderWidth="1px"
        borderColor="red.emphasized"
        backgroundColor="red.subtle"
        width="full"
        whiteSpace="pre-wrap"
        color="fg"
      >
        {error.message ||
          (!hasStacktrace && (
            <Text color="red.fg/60" fontStyle="italic">
              An error occurred (no exception message captured)
            </Text>
          ))}
        {hasStacktrace && (
          <Box>
            <Text as="code" fontSize="12px">
              {error.stacktrace.join("\n")}
            </Text>
          </Box>
        )}
      </Box>
    </SpanSection>
  );
}

function SpanOutput({ span }: { span: Span }) {
  if (span.output === undefined || span.output === null) return null;
  return (
    <SpanSection label={span.type === "llm" ? "Generated" : "Output"}>
      {!span.output && <Text>{"<empty>"}</Text>}
      {span.output && (
        <PreBox>
          <RedactedField field="output">
            <RenderInputOutput value={span.output.value} showTools />
          </RedactedField>
        </PreBox>
      )}
    </SpanSection>
  );
}

/**
 * @param props - Component props
 * @param props.span - The span object containing trace data
 * @param props.project - The project context (maintained for API compatibility)
 */
export function SpanDetails({
  span,
  allSpans,
}: {
  project: Project;
  span: Span;
  /** All spans in the trace, used to walk up parent chain for prompt reference lookup */
  allSpans?: Span[];
}) {
  const estimatedCost = (
    <Tooltip content="When `metrics.completion_tokens` and `metrics.prompt_tokens` are not available, they are estimated based on input, output and the model for calculating costs.">
      <Text as="span" color="fg.subtle" borderBottom="1px dotted">
        {" (estimated)"}
      </Text>
    </Tooltip>
  );

  const { buildUrl } = useGoToSpanInPlaygroundTabUrlBuilder();

  const canOpenSpanInPromptStudio = useMemo(() => {
    return span.type === "llm" && !!span.span_id;
  }, [span]);

  const promptRef = useMemo(() => promptRefFor({ span, allSpans }), [span, allSpans]);

  return (
    <VStack flexGrow={1} gap={3} align="start">
      <HStack width="full">
        <SpanTypeTag span={span} />
        <Heading as="h2" fontSize="22px" asChild>
          <OverflownTextWithTooltip lineClamp={1} wordBreak="break-word">
            {span.name ?? ("model" in span ? span.model : "(unnamed)")}
          </OverflownTextWithTooltip>
        </Heading>
        <Spacer />
      </HStack>
      <VStack align="start" color="fg.muted" width="full">
        <HStack width="full" justifyContent="space-between">
          <Text>
            <b>Span ID:</b> <Text as="code">{span.span_id}</Text>
          </Text>
          {canOpenSpanInPromptStudio && promptRef && (
            <OpenInPromptsMenu spanId={span.span_id} promptRef={promptRef} buildUrl={buildUrl} />
          )}
          {canOpenSpanInPromptStudio && !promptRef && (
            <Link href={buildUrl(span.span_id)?.toString() ?? ""} isExternal>
              <Button size="sm" colorPalette="orange">
                <Play size={16} />
                Open in Prompts
              </Button>
            </Link>
          )}
        </HStack>
        <HStack>
          <Text>
            <b>Timestamp:</b>{" "}
            {toDate(
              Temporal.Instant.fromEpochMilliseconds(span.timestamps.started_at),
            ).toISOString()}
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
          <TokensLine span={span} estimatedCost={estimatedCost} />
        )}
        {("vendor" in span || "model" in span) && (
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
        <SpanSection label="Params">
          <PreBox background="bg.panel/75">
            <RenderInputOutput
              value={JSON.stringify(
                Object.fromEntries(Object.entries(span.params).filter(([key]) => key !== "_keys")),
              )}
              collapsed={
                (!!span.input || !!span.output) && JSON.stringify(span.params).length > 100
              }
              showTools
            />
          </PreBox>
        </SpanSection>
      )}
      {span.input && (
        <SpanSection label="Input">
          <PreBox>
            <RedactedField field="input">
              <RenderInputOutput value={span.input.value} showTools />
            </RedactedField>
          </PreBox>
        </SpanSection>
      )}
      {"contexts" in span && span.contexts && (
        <SpanSection label="Contexts">
          <PreBox>
            <RenderInputOutput
              value={JSON.stringify(span.contexts.map(withParsedContent))}
              showTools
            />
          </PreBox>
        </SpanSection>
      )}
      {span.error ? <SpanException error={span.error} /> : <SpanOutput span={span} />}
    </VStack>
  );
}

/**
 * Dropdown menu for "Open in Prompts" when the span has a prompt reference.
 * Shows options to open the existing prompt or create a new one.
 */
function OpenInPromptsMenu({
  spanId,
  promptRef,
  buildUrl,
}: {
  spanId: string;
  promptRef: string;
  buildUrl: (spanId: string, action?: "open-existing" | "create-new") => URL | null;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="sm" colorPalette="orange">
          <Play size={16} />
          Open in Prompts
          <ChevronDown size={14} />
        </Button>
      </Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="open-existing" asChild>
          <Link href={buildUrl(spanId, "open-existing")?.toString() ?? ""} isExternal>
            Open {promptRef}
          </Link>
        </Menu.Item>
        <Menu.Item value="create-new" asChild>
          <Link href={buildUrl(spanId, "create-new")?.toString() ?? ""} isExternal>
            Create new prompt
          </Link>
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

export const getEvaluationResult = (span: Span): EvaluationResult | undefined => {
  if (!span.output?.value) {
    return undefined;
  }

  if (span.output.type !== "evaluation_result") return undefined;
  const { value } = span.output;
  try {
    const raw: unknown = typeof value === "string" ? JSON.parse(value) : value;
    const parsed = evaluationResultSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
};

function evaluationBadgeColor({
  evaluationResult,
  passed,
}: {
  evaluationResult: EvaluationResult | undefined;
  passed: boolean | undefined;
}) {
  if (passed !== undefined) return passed ? "green" : "red";
  return evaluationResult ? evaluationStatusColor(evaluationResult).split(".")[0] : "gray";
}

export const SpanTypeTag = ({ span }: { span: Span }) => {
  const evaluationResult = getEvaluationResult(span);
  const evaluationPassed_ = evaluationResult && evaluationPassed(evaluationResult);

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
              evaluation: evaluationBadgeColor({ evaluationResult, passed: evaluationPassed_ }),
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
    ? (span.timestamps.first_token_at ?? startedAt)
    : span.timestamps.finished_at;
  const duration = finishedAt - startedAt;

  return (
    <Tooltip
      content={
        <>
          Started at: {toDate(Temporal.Instant.fromEpochMilliseconds(startedAt)).toLocaleString()}
          <br />
          {renderFirstTokenDuration ? "First token at" : "Finished at"}:{" "}
          {toDate(Temporal.Instant.fromEpochMilliseconds(finishedAt)).toLocaleString()}
        </>
      }
    >
      <HStack gap={"6px"} color={span.error ? "red" : durationColor("span", duration)}>
        <Clock width={12} />
        <Text>{formatMilliseconds(duration)}</Text>
      </HStack>
    </Tooltip>
  );
};
