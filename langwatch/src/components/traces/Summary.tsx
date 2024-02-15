import {
  Alert,
  AlertIcon,
  Box,
  HStack,
  Skeleton,
  Tag,
  Text,
  Tooltip,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import React, {
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { HelpCircle } from "react-feather";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import { getTotalTokensDisplay } from "~/utils/getTotalTokensDisplay";
import type { Trace } from "../../server/tracer/types";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { getColorForString } from "../../utils/rotatingColors";

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
      paddingRight={4}
      paddingLeft={{ base: 4, lg: 0 }}
      paddingY={{ base: 3, lg: 6 }}
      _first={{ paddingLeft: 4 }}
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

type TraceSummaryProps = {
  traceId?: string;
};
export function TraceSummary(props?: TraceSummaryProps) {
  const { trace } = useTraceDetailsState(props?.traceId);

  const [height, setHeight] = useState<number | undefined>(undefined);
  const summaryRef = useRef<HTMLDivElement>();

  useEffect(() => {
    if (trace.data && summaryRef.current) {
      setHeight(summaryRef.current.offsetHeight);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!trace.data]);

  return trace.data ? (
    <TraceSummaryValues ref={summaryRef} trace={trace.data} />
  ) : trace.isError ? (
    <Alert status="error">
      <AlertIcon />
      An error has occurred trying to load this trace
    </Alert>
  ) : (
    <VStack
      gap={4}
      paddingX={4}
      paddingY={6}
      width="full"
      minHeight={height ? height + "px" : height}
      display="none"
    >
      <Skeleton width="full" height="20px" />
      <Skeleton width="full" height="20px" />
      <Skeleton width="full" height="20px" />
    </VStack>
  );
}

const TraceSummaryValues = React.forwardRef(function TraceSummaryValues(
  { trace }: { trace: Trace },
  ref
) {
  return (
    <HStack
      borderBottomWidth={1}
      borderColor="gray.300"
      width="full"
      align="stretch"
      spacing={[0, 0, 0, 4]}
      flexDirection={{ base: "column", lg: "row" }}
      ref={ref as any}
    >
      {trace.metadata.customer_id && (
        <SummaryItem label="Customer ID">
          <Text
            fontFamily={trace.metadata.customer_id ? "mono" : undefined}
            maxWidth="200px"
            wordBreak="break-all"
          >
            {trace.metadata.customer_id ?? "unknown"}
          </Text>
        </SummaryItem>
      )}
      <SummaryItem
        label="User ID"
        tooltip={
          !trace.metadata.user_id
            ? "Send the user_id to LangWatch to unlock various analysis per user, read more on our docs" /* TODO docs link */
            : undefined
        }
      >
        <Text
          fontFamily={trace.metadata.thread_id ? "mono" : undefined}
          maxWidth="200px"
          wordBreak="break-all"
        >
          {trace.metadata.user_id ?? "unknown"}
        </Text>
      </SummaryItem>
      <SummaryItem
        label="Thread ID"
        tooltip={
          !trace.metadata.thread_id
            ? "Send the thread_id to LangWatch to group the messages as a part of a single context, read more on our docs" /* TODO docs link */
            : undefined
        }
      >
        <Text
          fontFamily={trace.metadata.thread_id ? "mono" : undefined}
          maxWidth="200px"
          wordBreak="break-all"
        >
          {trace.metadata.thread_id ?? "unknown"}
        </Text>
      </SummaryItem>
      {trace.metadata.labels && (
        <SummaryItem label="Labels">
          {trace.metadata.labels.map((label) => (
            <Tag
              key={label}
              background={getColorForString("colors", label).background}
              color={getColorForString("colors", label).color}
              fontSize={12}
            >
              {label}
            </Tag>
          ))}
        </SummaryItem>
      )}
      {(!!trace.metrics.completion_tokens || !!trace.metrics.prompt_tokens) && (
        <SummaryItem
          label="Total Tokens"
          tooltip={
            trace.metrics.tokens_estimated
              ? "Token count is calculated by LangWatch when not available from the trace data"
              : "How many tokens were processed combining both input and output"
          }
        >
          {getTotalTokensDisplay(trace)}
        </SummaryItem>
      )}
      {trace.metrics.total_cost !== null &&
        trace.metrics.total_cost !== undefined && (
          <SummaryItem
            label="Total Cost"
            tooltip={
              "Based on the number of input and output tokens for each LLM call"
            }
          >
            {numeral(trace.metrics.total_cost).format("$0.00000a")}
          </SummaryItem>
        )}
      {trace.metrics.first_token_ms && (
        <SummaryItem
          label="Time to First Token"
          tooltip="How long did it took for the first token of the last span to arrive, that is, the smallest delay between request and the first output token to appear for the user"
        >
          {formatMilliseconds(trace.metrics.first_token_ms)}
        </SummaryItem>
      )}
      {trace.metrics.total_time_ms && (
        <SummaryItem
          label="Total Completion Time"
          tooltip="How long it took for completion output to be fully finished"
        >
          {formatMilliseconds(trace.metrics.total_time_ms)}
        </SummaryItem>
      )}
    </HStack>
  );
});
