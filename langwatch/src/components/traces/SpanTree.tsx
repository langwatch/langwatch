import {
  Alert,
  AlertIcon,
  Box,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Tag,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import numeral from "numeral";
import { useEffect } from "react";
import { Clock } from "react-feather";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { ElasticSearchSpan } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { isNotFound } from "../../utils/trpcError";
import { RenderInputOutput } from "./RenderInputOutput";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import { durationColor } from "~/utils/durationColor";
import { TraceToPlaygroundLink } from "../TraceToPlaygroundLink";

type SpanWithChildren = ElasticSearchSpan & { children: SpanWithChildren[] };

function buildTree(
  spans: ElasticSearchSpan[]
): Record<string, SpanWithChildren> {
  const lookup: Record<string, SpanWithChildren> = {};

  spans.forEach((span) => {
    lookup[span.span_id] = { ...span, children: [] };
  });

  spans.forEach((span) => {
    const lookupSpan = lookup[span.span_id];
    if (span.parent_id && lookup[span.parent_id] && lookupSpan) {
      lookup[span.parent_id]?.children.push?.(lookupSpan);
    }
  });

  return lookup;
}

interface SpanNodeProps {
  span: SpanWithChildren;
  level: number;
}

const SpanNode: React.FC<SpanNodeProps> = ({ span, level }) => {
  const router = useRouter();
  const currentSpanId =
    typeof router.query.span === "string" ? router.query.span : undefined;
  const { project } = useOrganizationTeamProject();

  if (!project) return null;

  const countAllNestedChildren = (node: {
    children: SpanWithChildren[];
  }): number => {
    return node.children.reduce((count, child) => {
      return count + 1 + countAllNestedChildren(child);
    }, 0);
  };
  const childrenInTheMiddleCount =
    countAllNestedChildren({
      children: span.children.slice(0, span.children.length - 1),
    }) + Math.min(span.children.length, 1);

  const lineHeight = `calc(100% - ${childrenInTheMiddleCount * 80}px - 14px)`;

  return (
    <VStack
      align="start"
      spacing={2}
      marginLeft={level == 0 ? "0" : level == 1 ? "10px" : "26px"}
      position="relative"
    >
      <Box
        zIndex={1}
        position="absolute"
        top="27px"
        marginLeft={level == 0 ? "21px" : "37px"}
        bottom={lineHeight}
        width="1px"
        bgColor="gray.400"
        _before={
          level > 0
            ? {
                content: "''",
                width: "18px",
                height: "12px",
                borderColor: "gray.400",
                borderStyle: "solid",
                borderTopWidth: 0,
                borderRightWidth: 0,
                borderLeftWidth: "1px",
                borderBottomWidth: "1px",
                borderBottomLeftRadius: "6px",
                position: "absolute",
                top: "-19px",
                left: "-7px",
                transform: "translateX(-100%)",
              }
            : undefined
        }
      />

      <HStack
        align="start"
        paddingY={2}
        paddingX={level > 0 ? 8 : 4}
        paddingRight={14}
        borderRadius={6}
        background={span.span_id === currentSpanId ? "gray.100" : undefined}
        _hover={{
          background: "gray.100",
        }}
        cursor="pointer"
        role="button"
        onClick={() => {
          void router.replace(
            {
              query: {
                ...router.query,
                span: span.span_id,
              },
            },
            undefined,
            { shallow: true }
          );
        }}
      >
        <HStack spacing={4}>
          <Box
            background="white"
            borderColor={span.error ? "red.400" : "gray.400"}
            borderWidth="3px"
            borderRadius="100%"
            width="12px"
            height="12px"
            position="relative"
            zIndex={1}
          ></Box>
          <SpanTypeTag span={span} />
        </HStack>
        <VStack align="start">
          <Text>
            {span.name ?? span.model ?? <Text color="gray.400">(unnamed)</Text>}
          </Text>
          <HStack fontSize={13} color="gray.500">
            <SpanDuration span={span} />
            {(span.metrics?.prompt_tokens !== undefined ||
              span.metrics?.completion_tokens !== undefined) && (
              <>
                <Text>·</Text>
                <Text>
                  {(span.metrics?.prompt_tokens ?? 0) +
                    (span.metrics?.completion_tokens ?? 0)}{" "}
                  tokens
                </Text>
              </>
            )}
            {span.metrics?.cost !== undefined &&
              span.metrics?.cost !== null && (
                <>
                  <Text>·</Text>
                  <Text fontSize={13} color="gray.500">
                    <SpanCost span={span} />
                  </Text>
                </>
              )}
          </HStack>
        </VStack>
      </HStack>
      {span.children.map((childSpan, index) => (
        <SpanNode key={childSpan.span_id} span={childSpan} level={level + 1} />
      ))}
    </VStack>
  );
};

const TreeRenderer: React.FC<{ spans: ElasticSearchSpan[] }> = ({ spans }) => {
  const tree = buildTree(spans);
  let rootSpans = spans.filter((s) => !s.parent_id);
  if (!rootSpans.length) {
    const spansById = spans.reduce(
      (acc, span) => {
        acc[span.span_id] = span;
        return acc;
      },
      {} as Record<string, ElasticSearchSpan>
    );
    rootSpans = spans.filter((s) => !s.parent_id || !spansById[s.parent_id]);
  }

  return (
    <VStack align="start" flexShrink={0} spacing={6}>
      {rootSpans.map((rootSpan, index) => {
        const span = tree[rootSpan.span_id];
        if (!span) return null;
        return <SpanNode key={rootSpan.span_id} span={span} level={0} />;
      })}
    </VStack>
  );
};

const SpanTypeTag = ({ span }: { span: ElasticSearchSpan }) => {
  return (
    <Tag
      colorScheme={
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
              unknown: "gray",
            }[span.type]
      }
      fontSize={13}
    >
      {span.type.toUpperCase()}
    </Tag>
  );
};

const SpanDuration = ({ span }: { span: ElasticSearchSpan }) => {
  const duration = span.timestamps.finished_at - span.timestamps.started_at;

  return (
    <Tooltip
      label={
        <>
          Started at: {new Date(span.timestamps.started_at).toLocaleString()}
          <br />
          Finished at: {new Date(span.timestamps.finished_at).toLocaleString()}
        </>
      }
    >
      <HStack
        spacing={"6px"}
        color={span.error ? "red" : durationColor("span", duration)}
      >
        <Clock width={12} />
        <Text>{formatMilliseconds(duration)}</Text>
      </HStack>
    </Tooltip>
  );
};

const SpanCost = ({ span }: { span: ElasticSearchSpan }) => {
  if (span.metrics?.cost === undefined) return null;

  return numeral(span.metrics.cost).format("$0.00000a");
};

type SpanTreeProps = {
  traceId: string;
};

export function SpanTree(props: SpanTreeProps) {
  const { traceId, spanId, trace } = useTraceDetailsState(props.traceId);
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const spans = api.spans.getAllForTrace.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    { enabled: !!project && !!traceId, refetchOnWindowFocus: false }
  );

  const span = spanId
    ? spans.data?.find((span) => span.span_id === spanId)
    : spans.data?.[0];

  useEffect(() => {
    if (
      (!spanId || spanId !== span?.span_id) &&
      project &&
      traceId &&
      spans.data &&
      spans.data[0]
    ) {
      void router.replace(
        {
          query: {
            ...router.query,
            span: spans.data[0].span_id,
          },
        },
        undefined,
        { shallow: true }
      );
    }
  }, [project, router, span?.span_id, spanId, spans.data, traceId]);

  if (isNotFound(trace.error)) {
    return <Alert status="error">Trace not found</Alert>;
  }

  const estimatedCost = (
    <Tooltip label="When `metrics.completion_tokens` and `metrics.prompt_tokens` are not available, they are estimated based on input, output and the model for calculating costs.">
      <Text as="span" color="gray.400" borderBottom="1px dotted">
        {" (estimated)"}
      </Text>
    </Tooltip>
  );

  return (
    <VStack width="full">
      {spans.data ? (
        <HStack
          align="start"
          width="full"
          spacing={10}
          flexDirection={{ base: "column", xl: "row" }}
        >
          <TreeRenderer spans={spans.data} />
          {span && (
            <VStack flexGrow={1} spacing={3} align="start">
              <HStack width="full">
                <SpanTypeTag span={span} />
                <Heading as="h2" fontSize={22}>
                  {span.name ?? span.model}
                </Heading>
                <Spacer />
                {project &&
                  span.type === "llm" &&
                  span.input?.type === "chat_messages" && (
                    <TraceToPlaygroundLink
                      projectSlug={project.slug}
                      traceId={traceId}
                      spanId={span.span_id}
                      tooltipLabel="Try different prompts and models for this LLM call on the playground"
                      buttonLabel="Try in Playground"
                    />
                  )}
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
                    {span.metrics?.tokens_estimated && estimatedCost}
                  </Text>
                )}
                {(span.vendor !== undefined || span.model !== undefined) && (
                  <Text>
                    <b>Model:</b>{" "}
                    {[span.vendor, span.model].filter((x) => x).join("/")}
                  </Text>
                )}
                {span.metrics?.cost !== undefined && (
                  <Text>
                    <b>Cost:</b>{" "}
                    {numeral(span.metrics.cost).format("$0.00000a")}
                    {span.metrics?.tokens_estimated && estimatedCost}
                  </Text>
                )}
              </VStack>
              {span.input && (
                <VStack
                  alignItems="flex-start"
                  spacing={2}
                  paddingTop={4}
                  width="full"
                >
                  <Box
                    fontSize={13}
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
                    <RenderInputOutput value={span.input?.value} />
                  </Box>
                </VStack>
              )}
              {span.contexts && (
                <VStack
                  alignItems="flex-start"
                  spacing={2}
                  paddingTop={4}
                  width="full"
                >
                  <Box
                    fontSize={13}
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
                    />
                  </Box>
                </VStack>
              )}
              {span.error ? (
                <VStack alignItems="flex-start" spacing={2} width="full">
                  <Box
                    fontSize={13}
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
                  <VStack alignItems="flex-start" spacing={2} width="full">
                    <Box
                      fontSize={13}
                      color="gray.400"
                      textTransform="uppercase"
                      fontWeight="bold"
                    >
                      Generated
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
                        <RenderInputOutput value={span.output.value} />
                      </Box>
                    )}
                  </VStack>
                )
              )}
            </VStack>
          )}
        </HStack>
      ) : spans.isError ? (
        <Alert status="error">
          <AlertIcon />
          An error has occurred trying to load the trace spans
        </Alert>
      ) : (
        <VStack gap={4} width="full" padding={4}>
          <Skeleton width="full" height="20px" />
          <Skeleton width="full" height="20px" />
          <Skeleton width="full" height="20px" />
        </VStack>
      )}
    </VStack>
  );
}
