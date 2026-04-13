import {
  Box,
  Heading,
  HStack,
  Skeleton,
  Spacer,
  type SystemStyleObject,
  Text,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { HelpCircle } from "react-feather";
import { Delayed } from "../Delayed";
import { Tooltip } from "../ui/tooltip";

export function SummaryMetric({
  label,
  current,
  previous,
  format,
  tooltip,
  increaseIs,
  titleProps,
}: {
  label: string;
  current?: number | string;
  previous?: number;
  format?: ((value: number) => string) | ((value: string) => string) | string;
  tooltip?: string;
  increaseIs?: "good" | "bad" | "neutral";
  titleProps?: {
    fontSize?: SystemStyleObject["fontSize"];
    textStyle?: SystemStyleObject["textStyle"];
    color?: SystemStyleObject["color"];
    fontWeight?: SystemStyleObject["fontWeight"];
  };
}) {
  return (
    <VStack
      minWidth="92px"
      flex={1}
      gap={2}
      align="start"
      justifyContent="space-between"
      borderLeftWidth="1px"
      borderLeftColor="border"
      paddingX={4}
      _first={{ paddingLeft: 0, borderLeft: "none" }}
    >
      <Heading
        textStyle="xs"
        color="fg.muted"
        fontWeight="normal"
        lineClamp={2}
        wordBreak="break-word"
        title={label}
        {...(titleProps ?? {})}
      >
        {label}
        {tooltip && (
          <Tooltip content={tooltip}>
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
  const change =
    typeof current === "number" && typeof previous === "number"
      ? Math.round(((current - previous) / (previous || 1)) * 100) / 100
      : undefined;
  const increaseReversal =
    increaseIs == "neutral" ? 0 : increaseIs === "bad" ? -1 : 1;

  const formatChangeValue = (value: number) => {
    const abs = Math.abs(value);
    if (abs > 9.99) return "999%+";
    return numeral(abs).format("0%");
  };

  const formatPreviousValue = (value: number) => {
    if (typeof format === "function") {
      // @ts-ignore
      return format(value);
    }
    return numeral(value).format(format ?? "0a");
  };

  const changeColor =
    change === undefined || change * increaseReversal == 0
      ? "gray.500"
      : change * increaseReversal > 0
        ? "green.500"
        : "red.500";

  return (
    <VStack align="start" gap={1}>
      <Box textStyle="2xl" fontWeight="600">
        {current !== undefined ? (
          typeof format === "function" ? (
            //@ts-ignore
            format(current)
          ) : (
            numeral(current).format(format ?? "0a")
          )
        ) : (
          <Delayed takeSpace>
            <Box paddingY="0.25em" height="2.35em">
              <Skeleton height="1em" width="78px" />
            </Box>
          </Delayed>
        )}
      </Box>
      {change !== undefined && (
        <HStack gap={1} textStyle="xs">
          {change !== 0 && (
            <Text fontWeight={500} color={changeColor}>
              {change > 0 ? "+" : ""}
              {formatChangeValue(change)}
            </Text>
          )}
          {typeof previous === "number" && (
            <Text color="fg.subtle">
              {change !== 0 ? "vs " : ""}
              {formatPreviousValue(previous)} prev
            </Text>
          )}
        </HStack>
      )}
    </VStack>
  );
}
