import {
  Alert,
  AlertIcon,
  Box,
  HStack,
  Skeleton,
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
import { getTotalTokensDisplay } from "~/utils/getTotalTokensDisplay";
import { useTraceDetailsState } from "../../hooks/useTraceDetailsState";
import type { Trace } from "../../server/tracer/types";
import { formatMilliseconds } from "../../utils/formatMilliseconds";
import { MetadataTag } from "../MetadataTag";
import { isNotFound } from "../../utils/trpcError";

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

export function TraceSummary(props: { traceId: string }) {
  const { trace } = useTraceDetailsState(props.traceId);

  return trace.data ? (
    <TraceSummaryValues trace={trace.data} />
  ) : trace.isError ? (
    <>
      <Alert status="error">
        <AlertIcon />
        An error has occurred trying to load this trace
      </Alert>
      {isNotFound(trace.error) && <Alert status="error">Trace not found</Alert>}
    </>
  ) : (
    <VStack gap={4} paddingX={4} paddingY={6} width="full">
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
    <>
      <HStack
        borderBottomWidth={
          !!trace.metrics?.completion_tokens ||
          !!trace.metrics?.prompt_tokens ||
          typeof trace.metrics?.total_cost === "number" ||
          !!trace.metrics?.first_token_ms ||
          !!trace.metrics?.total_time_ms
            ? 1
            : 0
        }
        borderColor="gray.300"
        width="full"
        align="stretch"
        gap={[4, 4, 4, 4]}
        flexDirection={{ base: "column", lg: "row" }}
        ref={ref as any}
      >
        {(!!trace.metrics?.completion_tokens ||
          !!trace.metrics?.prompt_tokens) && (
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
        {trace.metrics?.total_cost !== null &&
          trace.metrics?.total_cost !== undefined && (
            <SummaryItem
              label="Total Cost"
              tooltip={
                "Based on the number of input and output tokens for each LLM call"
              }
            >
              {numeral(trace.metrics.total_cost).format("$0.00000a")}
            </SummaryItem>
          )}
        {trace.metrics?.first_token_ms && (
          <SummaryItem
            label="Time to First Token"
            tooltip="How long did it took for the first token of the last span to arrive, that is, the smallest delay between request and the first output token to appear for the user"
          >
            {formatMilliseconds(trace.metrics.first_token_ms)}
          </SummaryItem>
        )}
        {trace.metrics?.total_time_ms && (
          <SummaryItem
            label="Total Completion Time"
            tooltip="How long it took for completion output to be fully finished"
          >
            {formatMilliseconds(trace.metrics.total_time_ms)}
          </SummaryItem>
        )}
      </HStack>

      <HStack gap={3} marginY={8} wrap={"wrap"}>
        {Object.entries({
          trace_id: trace.trace_id,
          ...trace.metadata,
        }).map(([key, value], i) => {
          let renderValue = value;

          if (Array.isArray(value) && value.length === 0) {
            renderValue = "";
          } else if (Array.isArray(value) && value.length > 0) {
            renderValue = value.join(", ");
          } else if (typeof value === "object" && value !== null) {
            renderValue = JSON.stringify(value);
          } else if (renderValue === "") {
            renderValue = '""';
          } else if (typeof value !== "string") {
            renderValue = `${value as any}`;
          }

          return (
            renderValue && (
              <MetadataTag key={i} label={key} value={renderValue as string} />
            )
          );
        })}
      </HStack>
    </>
  );
});
