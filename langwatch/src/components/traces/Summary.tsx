import { Box, HStack, Text, Tooltip, VStack } from "@chakra-ui/react";
import type { Trace } from "../../server/tracer/types";
import numeral from "numeral";
import type { PropsWithChildren } from "react";
import { HelpCircle } from "react-feather";
import { getTotalTokensDisplay } from "../../mappers/trace";
import { formatMilliseconds } from "../../utils/formatMilliseconds";

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

export const TraceSummary = ({ trace }: { trace: Trace }) => {
  return (
    <HStack
      spacing={4}
      borderTopWidth={1}
      borderBottomWidth={1}
      borderColor="gray.300"
      width="full"
      align="stretch"
    >
      <SummaryItem
        label="User ID"
        tooltip={
          !trace.user_id
            ? "Send the user_id to LangWatch to unlock various analysis per user, read more on our docs" /* TODO docs link */
            : undefined
        }
      >
        <Text
          fontFamily={trace.thread_id ? "mono" : undefined}
          maxWidth="200px"
          wordBreak="break-all"
        >
          {trace.user_id ?? "unknown"}
        </Text>
      </SummaryItem>
      <SummaryItem
        label="Thread ID"
        tooltip={
          !trace.thread_id
            ? "Send the thread_id to LangWatch to group the messages as a part of a single context, read more on our docs" /* TODO docs link */
            : undefined
        }
      >
        <Text
          fontFamily={trace.thread_id ? "mono" : undefined}
          maxWidth="200px"
          wordBreak="break-all"
        >
          {trace.thread_id ?? "unknown"}
        </Text>
      </SummaryItem>
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
};
