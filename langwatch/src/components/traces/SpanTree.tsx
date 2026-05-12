import { Alert, Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "~/utils/compat/next-router";
import numeral from "numeral";
import { useEffect, useMemo } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useSpanTreeLoader } from "../../hooks/useSpanTreeLoader";
import { useTraceUpdateListener } from "../../hooks/useTraceUpdateListener";
import type { Span } from "../../server/tracer/types";

import {
  CheckStatusIcon,
  evaluationStatusColor,
} from "../checks/EvaluationStatus";
import { HoverableBigText } from "../HoverableBigText";
import { IconWrapper } from "../IconWrapper";
import { formatEvaluationSingleValue } from "./EvaluationStatusItem";
import {
  getEvaluationResult,
  SpanDetails,
  SpanDuration,
  SpanTypeTag,
} from "./SpanDetails";

type SpanWithChildren = Span & { children: SpanWithChildren[] };

function buildTree(spans: Span[]): Record<string, SpanWithChildren> {
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
  isNew?: boolean;
}

const SpanNode: React.FC<SpanNodeProps> = ({ span, level, isNew }) => {
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

  const lineHeight = `calc(100% - ${childrenInTheMiddleCount * 76}px - 14px)`;

  const evaluationResult =
    span.type === "evaluation" ? getEvaluationResult(span) : undefined;

  return (
    <VStack
      align="start"
      gap={2}
      marginLeft={level == 0 ? "0" : level == 1 ? "10px" : "26px"}
      position="relative"
      css={isNew ? {
        "@keyframes spanFadeIn": {
          from: { opacity: 0, transform: "translateX(-8px)" },
          to: { opacity: 1, transform: "translateX(0)" },
        },
        animation: "spanFadeIn 0.3s ease-out",
      } : undefined}
    >
      <Box
        zIndex={1}
        position="absolute"
        top="27px"
        marginLeft={level == 0 ? "21px" : "37px"}
        bottom={lineHeight}
        width="1px"
        bgColor="border.emphasized"
        _before={
          level > 0
            ? {
                content: "''",
                width: "18px",
                height: "12px",
                borderColor: "border.emphasized",
                borderStyle: "solid",
                borderTopWidth: 0,
                borderRightWidth: 0,
                borderLeftWidth: "1px",
                borderBottomWidth: "1px",
                borderBottomLeftRadius: "6px",
                position: "absolute",
                top: "-20px",
                left: "-8px",
                transform: "translateX(-100%)",
              }
            : undefined
        }
      />

      <HStack
        align="start"
        paddingY={2}
        paddingX={level > 0 ? 8 : 4}
        paddingRight={4}
        borderRadius={6}
        background={
          isNew
            ? "orange.subtle"
            : span.span_id === currentSpanId
              ? "bg.muted"
              : undefined
        }
        _hover={{
          background: "bg.muted",
        }}
        cursor="pointer"
        role="button"
        transition="background 0.6s ease-out"
        onClick={() => {
          void router.replace(
            {
              query: {
                ...router.query,
                span: span.span_id,
              },
            },
            undefined,
            { shallow: true },
          );
        }}
      >
        <HStack gap={4}>
          <Box
            background="bg.panel"
            borderColor={span.error ? "red.400" : "border.emphasized"}
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
          <HStack>
            <HoverableBigText
              color={!span.name && !("model" in span) ? "gray.400" : undefined}
              maxWidth="300px"
              lineClamp={1}
              expandable={false}
            >
              {span.name ?? ("model" in span ? span.model : "(unnamed)")}
            </HoverableBigText>
            {evaluationResult && (
              <IconWrapper
                width="18px"
                height="18px"
                color={evaluationStatusColor(evaluationResult)}
              >
                <CheckStatusIcon check={evaluationResult} />
              </IconWrapper>
            )}
          </HStack>
          <HStack fontSize="13px" color="fg.muted">
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
                  <Text fontSize="13px" color="fg.muted">
                    <SpanCost span={span} />
                  </Text>
                </>
              )}
            {((evaluationResult?.score !== undefined &&
              evaluationResult?.score !== null) ||
              (evaluationResult?.passed !== undefined &&
                evaluationResult?.passed !== null)) && (
              <>
                <Text>·</Text>
                <Text
                  fontSize="13px"
                  color={evaluationStatusColor(evaluationResult)}
                >
                  {formatEvaluationSingleValue({
                    ...evaluationResult,
                    label: undefined,
                  })}
                </Text>
              </>
            )}
            {evaluationResult?.label !== undefined &&
              evaluationResult?.label !== null && (
                <>
                  <Text>·</Text>
                  <Text
                    fontSize="13px"
                    color={evaluationStatusColor(evaluationResult)}
                  >
                    {evaluationResult.label}
                  </Text>
                </>
              )}
          </HStack>
        </VStack>
      </HStack>
      {span.children.map((childSpan) => (
        <SpanNode
          key={childSpan.span_id}
          span={childSpan}
          level={level + 1}
          isNew={isNew}
        />
      ))}
    </VStack>
  );
};

const TreeRenderer: React.FC<{
  spans: Span[];
  newSpanIds: Set<string>;
}> = ({ spans, newSpanIds }) => {
  const tree = buildTree(spans);

  const spansById = spans.reduce(
    (acc, span) => {
      acc[span.span_id] = span;
      return acc;
    },
    {} as Record<string, Span>,
  );
  const rootSpans = spans.filter(
    (s) => !s.parent_id || !spansById[s.parent_id],
  );

  return (
    <VStack align="start" flexShrink={0} gap={6}>
      {rootSpans.map((rootSpan) => {
        const span = tree[rootSpan.span_id];
        if (!span) return null;
        return (
          <SpanNode
            key={rootSpan.span_id}
            span={span}
            level={0}
            isNew={newSpanIds.has(rootSpan.span_id)}
          />
        );
      })}
    </VStack>
  );
};

const SpanCost = ({ span }: { span: Span }) => {
  if (span.metrics?.cost === undefined) return null;

  return numeral(span.metrics.cost).format("$0.00000a");
};

type SpanTreeProps = {
  traceId: string;
};

export function SpanTree(props: SpanTreeProps) {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const spanId =
    typeof router.query.span === "string" ? router.query.span : undefined;

  const loader = useSpanTreeLoader({
    projectId: project?.id ?? "",
    traceId: props.traceId,
    enabled: !!project && !!props.traceId,
  });

  useTraceUpdateListener({
    projectId: project?.id ?? "",
    traceId: props.traceId,
    onSpanStored: () => void loader.onSpanStored(),
    onTraceSummaryUpdated: () => void loader.onSpanStored(),
    enabled: !!project && !!props.traceId,
    debounceMs: 300,
    maxWaitMs: 500,
  });

  const sortedSpans = loader.spans;

  const span = useMemo(() => {
    if (!sortedSpans.length) return undefined;
    return spanId
      ? sortedSpans.find((s) => s.span_id === spanId)
      : sortedSpans[0];
  }, [sortedSpans, spanId]);

  useEffect(() => {
    if (
      (!spanId || spanId !== span?.span_id) &&
      project &&
      props.traceId &&
      sortedSpans.length > 0 &&
      sortedSpans[0]
    ) {
      void router.replace(
        {
          query: {
            ...router.query,
            span: sortedSpans[0].span_id,
          },
        },
        undefined,
        { shallow: true },
      );
    }
  }, [project, router, span?.span_id, spanId, sortedSpans, props.traceId]);

  if (loader.isLoading) {
    return null;
  }

  return (
    <VStack width="full">
      {sortedSpans.length > 0 ? (
        <>
          {loader.isBackfilling && (
            <HStack
              width="full"
              paddingX={6}
              paddingY={1}
              fontSize="13px"
              color="fg.muted"
            >
              <Text>
                Loading spans: {loader.loadedCount} / {loader.total}
              </Text>
            </HStack>
          )}
          <HStack
            align="start"
            width="full"
            gap={10}
            paddingX={6}
            flexDirection={{ base: "column", xl: "row" }}
          >
            <TreeRenderer
              spans={sortedSpans}
              newSpanIds={loader.newSpanIds}
            />
            {project && span && (
              <SpanDetails
                project={project}
                span={span}
                allSpans={sortedSpans}
              />
            )}
          </HStack>
        </>
      ) : loader.error ? (
        <Alert.Root status="error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              An error has occurred trying to load the trace spans
            </Alert.Description>
          </Alert.Content>
        </Alert.Root>
      ) : null}
    </VStack>
  );
}
