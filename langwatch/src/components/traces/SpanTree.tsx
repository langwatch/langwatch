import {
  Alert,
  AlertIcon,
  Box,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useRouter } from "next/router";
import numeral from "numeral";
import { useEffect } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import type { ElasticSearchSpan } from "../../server/tracer/types";
import { api } from "../../utils/api";
import { isNotFound } from "../../utils/trpcError";
import {
  getEvaluationResult,
  SpanDetails,
  SpanDuration,
  SpanTypeTag,
} from "./SpanDetails";
import {
  checkStatusColorMap,
  CheckStatusIcon,
} from "../checks/EvaluationStatus";
import { IconWrapper } from "../IconWrapper";

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
          <HStack>
            <Text>
              {span.name ?? span.model ?? (
                <Text color="gray.400">(unnamed)</Text>
              )}
            </Text>
            {(() => {
              if (span.type !== "evaluation") return null;

              const evaluationResult = getEvaluationResult(span);
              if (!evaluationResult) return null;

              return (
                <IconWrapper
                  width="18px"
                  height="18px"
                  color={checkStatusColorMap(evaluationResult)}
                >
                  <CheckStatusIcon
                    check={{
                      passed: evaluationResult.passed,
                      status: "processed",
                    }}
                  />
                </IconWrapper>
              );
            })()}
          </HStack>
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
      {span.children.map((childSpan) => (
        <SpanNode key={childSpan.span_id} span={childSpan} level={level + 1} />
      ))}
    </VStack>
  );
};

const TreeRenderer: React.FC<{ spans: ElasticSearchSpan[] }> = ({ spans }) => {
  const tree = buildTree(spans);

  const spansById = spans.reduce(
    (acc, span) => {
      acc[span.span_id] = span;
      return acc;
    },
    {} as Record<string, ElasticSearchSpan>
  );
  const rootSpans = spans.filter(
    (s) => !s.parent_id || !spansById[s.parent_id]
  );

  return (
    <VStack align="start" flexShrink={0} spacing={6}>
      {rootSpans.map((rootSpan) => {
        const span = tree[rootSpan.span_id];
        if (!span) return null;
        return <SpanNode key={rootSpan.span_id} span={span} level={0} />;
      })}
    </VStack>
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
          {project && span && <SpanDetails project={project} span={span} />}
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
