import { Box, Heading, Skeleton, type SystemStyleObject, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import { HelpCircle } from "react-feather";
import { Delayed } from "./delayed.tsx";
import { Tooltip } from "@langwatch/design-system/tooltip";

function CurrentValue({
  current,
  format,
}: {
  current?: number | string;
  format?: ((value: number) => string) | ((value: string) => string) | string;
}) {
  if (current === undefined) {
    return (
      <Delayed takeSpace>
        <Skeleton height="1.5em" width="78px" />
      </Delayed>
    );
  }
  if (typeof format === "function") {
    // @ts-expect-error the metric's `format` is a string or a formatter, and
    // the narrowing above does not reach through the union's declaration.
    return <>{format(current)}</>;
  }

  return <>{numeral(current).format(format ?? "0a")}</>;
}

/** No delta reads neutral; a directionless metric stays muted either way. */
function changeColorFor({
  change,
  increaseReversal,
}: {
  change: number | undefined;
  increaseReversal: number;
}): string {
  if (change === undefined || change === 0) return "gray.500";
  if (increaseReversal === 0) return "fg.muted";

  return change * increaseReversal > 0 ? "green.500" : "red.500";
}

export function SummaryMetric({
  label,
  current,
  previous,
  format,
  tooltip,
  increaseIs,
  noDataUrl,
  titleProps,
}: {
  label: string;
  current?: number | string;
  previous?: number;
  format?: ((value: number) => string) | ((value: string) => string) | string;
  tooltip?: string;
  increaseIs?: "good" | "bad" | "neutral";
  noDataUrl?: string;
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
        noDataUrl={noDataUrl}
      />
    </VStack>
  );
}

export function SummaryMetricValue({
  current,
  previous,
  format,
  increaseIs = "good",
  noDataUrl,
}: {
  current?: number | string;
  previous?: number;
  format?: ((value: number) => string) | ((value: string) => string) | string;
  increaseIs?: "good" | "bad" | "neutral";
  noDataUrl?: string;
}) {
  const isZeroZero =
    current !== undefined &&
    (current === 0 || current === "0") &&
    (previous === undefined || previous === 0);

  if (isZeroZero) {
    return (
      <VStack align="start" gap={1}>
        <Box textStyle="2xl" fontWeight="600" color="fg.muted">
          -
        </Box>
        <Text textStyle="xs" color="fg.subtle">
          No data yet
          {noDataUrl && (
            <>
              {" · "}
              <a
                href={noDataUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "underline" }}
              >
                Set up
              </a>
            </>
          )}
        </Text>
      </VStack>
    );
  }

  // A delta needs a real baseline: against a zero/absent previous period any
  // percentage is meaningless (it used to render as "+999%+ / 0 previous"),
  // so the value stands alone until there is something to compare with.
  const isComparable = typeof current === "number" && typeof previous === "number" && previous > 0;
  const change = isComparable
    ? Math.round(((current - previous) / previous) * 100) / 100
    : undefined;
  const directedReversal = increaseIs === "bad" ? -1 : 1;
  const increaseReversal = increaseIs === "neutral" ? 0 : directedReversal;

  const formatChangeValue = (value: number) => {
    const abs = Math.abs(value);
    if (abs > 9.99) return "999%+";
    return numeral(abs).format("0%");
  };

  const formatPreviousValue = (value: number) => {
    if (typeof format === "function") {
      // @ts-expect-error the metric's `format` is a string or a formatter, and
      // the narrowing above does not reach through the union's declaration.
      return format(value);
    }
    return numeral(value).format(format ?? "0a");
  };

  const changeColor = changeColorFor({ change, increaseReversal });

  return (
    <VStack align="start" gap={1}>
      <Box textStyle="2xl" fontWeight="600">
        <CurrentValue current={current} format={format} />
      </Box>
      {change !== undefined && (
        <VStack align="start" gap={0} textStyle="xs">
          {change !== 0 && (
            <Text fontWeight={500} color={changeColor}>
              {change > 0 ? "+" : "-"}
              {formatChangeValue(change)}
            </Text>
          )}
          {typeof previous === "number" && (
            <Text color="fg.muted">{formatPreviousValue(previous)} previous</Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}
