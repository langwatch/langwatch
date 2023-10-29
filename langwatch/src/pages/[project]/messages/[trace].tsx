import {
  Alert,
  AlertIcon,
  Box,
  HStack,
  Heading,
  Skeleton,
  Tag,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useState, type PropsWithChildren, useEffect } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { getTotalTokensDisplay } from "../../../mappers/trace";
import { api } from "../../../utils/api";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import ErrorPage from "next/error";
import { isNotFound } from "../../../utils/trpcError";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { Clock, HelpCircle } from "react-feather";
import type { ElasticSearchSpan } from "../../../server/tracer/types";
import { Link } from "@chakra-ui/next-js";

type SpanWithChildren = ElasticSearchSpan & { children: SpanWithChildren[] };

function buildTree(
  spans: ElasticSearchSpan[]
): Record<string, SpanWithChildren> {
  const lookup: Record<string, SpanWithChildren> = {};

  spans.forEach((span) => {
    lookup[span.id] = { ...span, children: [] };
  });

  spans.forEach((span) => {
    const lookupSpan = lookup[span.id];
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
        bottom="56px"
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

      <Link
        href={`/${project.slug}/messages/${span.trace_id}/${span.id}`}
        replace={true}
        _hover={{ textDecoration: "none" }}
      >
        <HStack
          align="start"
          paddingY={2}
          paddingX={level > 0 ? 8 : 4}
          paddingRight={14}
          borderRadius={6}
          background={span.id === currentSpanId ? "gray.200" : undefined}
          _hover={{
            background: "gray.200",
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
            <Text>{span.name ?? span.model}</Text>
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
            </HStack>
          </VStack>
        </HStack>
      </Link>
      {span.children.map((childSpan) => (
        <SpanNode key={childSpan.id} span={childSpan} level={level + 1} />
      ))}
    </VStack>
  );
};

const TreeRenderer: React.FC<{ spans: ElasticSearchSpan[] }> = ({ spans }) => {
  const tree = buildTree(spans);
  const rootSpans = spans.filter((s) => !s.parent_id);

  return (
    <VStack flexShrink={0} spacing={6}>
      {rootSpans.map((rootSpan) => {
        const span = tree[rootSpan.id];
        if (!span) return null;
        return <SpanNode key={rootSpan.id} span={span} level={0} />;
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
        color={
          duration > 30 * 1000
            ? "red"
            : duration > 10 * 1000
            ? "yellow.600"
            : "green"
        }
      >
        <Clock width={12} />
        <Text>{formatMilliseconds(duration)}</Text>
      </HStack>
    </Tooltip>
  );
};

export default function Trace() {
  const router = useRouter();
  const traceId =
    typeof router.query.trace === "string" ? router.query.trace : undefined;
  const spanId =
    typeof router.query.span === "string" ? router.query.span : undefined;
  const { project } = useOrganizationTeamProject();
  const trace = api.traces.getById.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    { enabled: !!project && !!traceId, refetchOnWindowFocus: false }
  );
  const spans = api.spans.getAllForTrace.useQuery(
    { projectId: project?.id ?? "", traceId: traceId ?? "" },
    { enabled: !!project && !!traceId, refetchOnWindowFocus: false }
  );
  const span = spanId
    ? spans.data?.find((span) => span.id === spanId)
    : undefined;

  useEffect(() => {
    if (!spanId && project && traceId && spans.data && spans.data[0]) {
      void router.replace(
        `/${project.slug}/messages/${traceId}/${spans.data[0].id}`
      );
    }
  }, [project, router, spanId, spans.data, traceId]);

  const SummaryItem = ({
    label,
    tooltip,
    children,
  }: PropsWithChildren<{ label: string; tooltip?: string }>) => {
    return (
      <VStack
        borderRightWidth="1px"
        borderRightColor="gray.300"
        alignItems="flex-start"
        paddingY={6}
        paddingRight={4}
        _last={{ border: "none" }}
      >
        <HStack>
          <b>{label}</b>
          {tooltip && (
            <Tooltip label={tooltip}>
              <HelpCircle width="14px" />
            </Tooltip>
          )}
        </HStack>
        <Box color="gray.700">{children}</Box>
      </VStack>
    );
  };

  if (isNotFound(trace.error)) {
    return <ErrorPage statusCode={404} />;
  }

  return (
    <DashboardLayout backgroundColor="white">
      <VStack
        maxWidth="1600"
        paddingY={6}
        paddingX={12}
        alignSelf="flex-start"
        alignItems="flex-start"
        width="full"
        spacing={10}
      >
        <VStack spacing={6} alignItems="flex-start" width="full">
          <Heading as="h1">Trace Detail</Heading>
          {trace.data ? (
            <HStack
              spacing={4}
              borderTopWidth={1}
              borderBottomWidth={1}
              borderColor="gray.300"
              width="full"
            >
              <SummaryItem label="ID">
                <Text as="span" fontFamily="mono">
                  {traceId}
                </Text>
              </SummaryItem>
              {(!!trace.data.metrics.completion_tokens ||
                !!trace.data.metrics.prompt_tokens) && (
                <SummaryItem
                  label="Total Tokens"
                  tooltip={
                    trace.data.metrics.tokens_estimated
                      ? "Token count is calculated by LangWatch when not available from the trace data"
                      : "How many tokens were processed combining both input and output"
                  }
                >
                  {getTotalTokensDisplay(trace.data)}
                </SummaryItem>
              )}
              {trace.data.metrics.first_token_ms && (
                <SummaryItem
                  label="Time to First Token"
                  tooltip="How long did it took for the first token of the last span to arrive, that is, the smallest delay between request and the first output token to appear for the user"
                >
                  {formatMilliseconds(trace.data.metrics.first_token_ms)}
                </SummaryItem>
              )}
              {trace.data.metrics.total_time_ms && (
                <SummaryItem
                  label="Total Completion Time"
                  tooltip="How long it took for completion output to be fully finished"
                >
                  {formatMilliseconds(trace.data.metrics.total_time_ms)}
                </SummaryItem>
              )}
            </HStack>
          ) : trace.isError ? (
            <Alert status="error">
              <AlertIcon />
              An error has occurred trying to load this trace
            </Alert>
          ) : (
            <VStack gap={4} width="full">
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
              <Skeleton width="full" height="20px" />
            </VStack>
          )}
        </VStack>
        {spans.data ? (
          <HStack align="start" width="full" spacing={10}>
            <TreeRenderer spans={spans.data} />
            {span && (
              <VStack flexGrow={1} spacing={3} align="start">
                <HStack>
                  <SpanTypeTag span={span} />
                  <Heading as="h2" fontSize={22}>
                    {span.name ?? span.model}
                  </Heading>
                </HStack>
                <VStack align="start" color="gray.500">
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
                        (span.metrics?.completion_tokens ?? 0)}{" "}
                      tokens
                    </Text>
                  )}
                  {(span.vendor !== undefined || span.model !== undefined) && (
                    <Text>
                      <b>Model:</b>{" "}
                      {[span.vendor, span.model].filter((x) => x).join("/")}
                    </Text>
                  )}
                </VStack>
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
                    {span.input?.value.toString()}
                  </Box>
                </VStack>
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
                  <VStack alignItems="flex-start" spacing={2} width="full">
                    <Box
                      fontSize={13}
                      color="gray.400"
                      textTransform="uppercase"
                      fontWeight="bold"
                    >
                      Generated
                    </Box>
                    {span.outputs.length == 0 && <Text>{"<empty>"}</Text>}
                    {span.outputs.map((output, index) => (
                      <Box
                        key={index}
                        as="pre"
                        borderRadius="6px"
                        padding={4}
                        borderWidth="1px"
                        borderColor="gray.300"
                        width="full"
                        whiteSpace="pre-wrap"
                      >
                        {output.value.toString()}
                      </Box>
                    ))}
                  </VStack>
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
          <VStack gap={4} width="full">
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
            <Skeleton width="full" height="20px" />
          </VStack>
        )}
      </VStack>
    </DashboardLayout>
  );
}
