import {
  Box,
  Heading,
  Skeleton,
  Tooltip,
  VStack,
  Text,
  HStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { ArrowDown, ArrowUp, HelpCircle } from "react-feather";

export function SummaryMetric({
  label,
  current,
  previous,
  format,
  tooltip,
  increaseIs,
}: {
  label: string;
  current?: number | string;
  previous?: number;
  format?: ((value: number) => string) | ((value: string) => string) | string;
  tooltip?: string;
  increaseIs?: "good" | "bad" | "neutral";
}) {
  return (
    <VStack
      maxWidth="192"
      spacing={4}
      align="start"
      justifyContent="space-between"
      borderLeftWidth="1px"
      borderLeftColor="gray.300"
      paddingX={4}
      _first={{ paddingLeft: 0, borderLeft: "none" }}
    >
      <Heading
        fontSize="13"
        color="gray.500"
        fontWeight="normal"
        lineHeight="1.5em"
        noOfLines={3}
        wordBreak="break-word"
        title={label}
      >
        {label}
        {tooltip && (
          <Tooltip label={tooltip}>
            <HelpCircle
              style={{
                display: "inline-block",
                verticalAlign: "middle",
                marginTop: "-3px",
                marginLeft: "4px",
              }}
              width="14px"
            />
          </Tooltip>
        )}
      </Heading>
      <SummaryMetricValue
        current={current}
        previous={previous}
        format={format}
        increaseIs={increaseIs}
      />
    </VStack>
  );
}

export function SummaryMetricValue({
  current,
  previous,
  format,
  increaseIs = "good",
}: {
  current?: number | string;
  previous?: number;
  format?: ((value: number) => string) | ((value: string) => string) | string;
  increaseIs?: "good" | "bad" | "neutral";
}) {
  return (
    <VStack align="start" spacing={1}>
      <Box fontSize="28" fontWeight="600">
        {current !== undefined ? (
          typeof format === "function" ? (
            //@ts-ignore
            format(current)
          ) : (
            numeral(current).format(format ?? "0a")
          )
        ) : (
          <Box paddingY="0.25em">
            <Skeleton height="1em" width="80px" />
          </Box>
        )}
      </Box>
      <MetricChange
        current={current}
        previous={previous}
        increaseIs={increaseIs}
      />
    </VStack>
  );
}

export function MetricChange({
  current,
  previous,
  increaseIs = "good",
}: {
  current?: number | string;
  previous?: number;
  increaseIs?: "good" | "bad" | "neutral";
}) {
  const change =
    typeof current === "number" && typeof previous === "number"
      ? Math.round(((current - previous) / (previous || 1)) * 100) / 100
      : undefined;
  const increaseReversal =
    increaseIs == "neutral" ? 0 : increaseIs === "bad" ? -1 : 1;

  return change !== undefined ? (
    <HStack
      fontSize="13"
      fontWeight={600}
      spacing={1}
      color={
        change * increaseReversal == 0
          ? "gray.500"
          : change * increaseReversal > 0
          ? "green.500"
          : "red.500"
      }
    >
      {change == 0 ? null : change > 0 ? (
        <ArrowUp size={13} />
      ) : (
        <ArrowDown size={13} />
      )}
      <Text>{change == 0 ? "-" : numeral(Math.abs(change)).format("0%")}</Text>
    </HStack>
  ) : null;
}
