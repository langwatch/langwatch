import {
  Box,
  Button,
  HStack,
  Separator,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import numeral from "numeral";
import React, { useEffect, useMemo, useState } from "react";
import { Tooltip } from "../../../components/ui/tooltip";
import { FormatMoney } from "../../../optimization_studio/components/FormatMoney";
import type { AppRouter } from "../../../server/api/root";
import type { ExperimentRun } from "../../../server/evaluations-v3/services/types";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { formatMoney } from "../../../utils/formatMoney";
import { HoverableBigText } from "../../HoverableBigText";
import { EvaluationProgressBar } from "./EvaluationProgressBar";

export function BatchEvaluationV2EvaluationSummary({
  run,
  showProgress = false,
  onStop,
}: {
  run: NonNullable<
    UseTRPCQueryResult<
      inferRouterOutputs<AppRouter>["experiments"]["getExperimentBatchEvaluationRuns"],
      TRPCClientErrorLike<AppRouter>
    >["data"]
  >["runs"][number];
  showProgress?: boolean;
  onStop?: () => void;
}) {
  const [currentTimestamp, setCurrentTimestamp] = useState(0);
  const finishedAt = useMemo(() => {
    return getFinishedAt(run.timestamps, currentTimestamp);
  }, [run.timestamps, currentTimestamp]);

  const runtime = Math.max(
    run.timestamps.createdAt
      ? (finishedAt ?? currentTimestamp) -
          new Date(run.timestamps.createdAt).getTime()
      : 0,
    0,
  );

  useEffect(() => {
    if (finishedAt) return;

    const interval = setInterval(() => {
      setCurrentTimestamp(new Date().getTime());
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!finishedAt]);

  return (
    <VStack
      width="full"
      background="white"
      gap={0}
      position="sticky"
      left={0}
      bottom={0}
      borderTop="1px solid"
      borderColor="border"
      overflowX="auto"
      overflowY="hidden"
      flexShrink={0}
    >
      <HStack width="100%" paddingY={4} paddingX={6} gap={5}>
        {Object.entries(run.summary.evaluations).map(([_, evaluation]) => {
          return (
            <React.Fragment key={evaluation.name}>
              <VStack align="start" gap={1}>
                <HoverableBigText
                  fontWeight="500"
                  lineClamp={2}
                  expandable={false}
                >
                  {evaluation.name}
                </HoverableBigText>
                <HoverableBigText lineClamp={1} expandable={false}>
                  {formatEvaluationSummary(evaluation)}
                </HoverableBigText>
              </VStack>
              <Separator orientation="vertical" height="48px" />
            </React.Fragment>
          );
        })}
        <VStack align="start" gap={1}>
          <HoverableBigText fontWeight="500" lineClamp={2} expandable={false}>
            Mean Cost
          </HoverableBigText>
          <Box lineClamp={1} whiteSpace="nowrap">
            <FormatMoney
              amount={
                (run.summary.datasetAverageCost ?? 0) +
                (run.summary.evaluationsAverageCost ?? 0)
              }
              currency="USD"
              format="$0.00[00]"
              tooltip={
                <VStack align="start" gap={0}>
                  <Text>
                    Prediction mean cost:{" "}
                    {run.summary.datasetAverageCost
                      ? formatMoney(
                          {
                            amount: run.summary.datasetAverageCost,
                            currency: "USD",
                          },
                          "$0.00[00]",
                        )
                      : "-"}
                  </Text>
                  <Text>
                    Evaluation mean cost:{" "}
                    {run.summary.evaluationsAverageCost
                      ? formatMoney(
                          {
                            amount: run.summary.evaluationsAverageCost,
                            currency: "USD",
                          },
                          "$0.00[00]",
                        )
                      : "-"}
                  </Text>
                </VStack>
              }
            />
          </Box>
        </VStack>
        <Separator orientation="vertical" height="48px" />
        <VStack align="start" gap={1}>
          <HoverableBigText fontWeight="500" lineClamp={1} expandable={false}>
            Mean Duration
          </HoverableBigText>
          <Tooltip
            content={
              <VStack align="start" gap={0}>
                <Text>
                  Prediction mean duration:{" "}
                  {run.summary.datasetAverageDuration
                    ? formatMilliseconds(run.summary.datasetAverageDuration)
                    : "-"}
                </Text>
                <Text>
                  Evaluation mean duration:{" "}
                  {run.summary.evaluationsAverageDuration
                    ? formatMilliseconds(
                        run.summary.evaluationsAverageDuration,
                      )
                    : "-"}
                </Text>
              </VStack>
            }
            positioning={{ placement: "top" }}
          >
            <Text>
              {formatMilliseconds(
                (run.summary.datasetAverageDuration ?? 0) +
                  (run.summary.evaluationsAverageDuration ?? 0),
              )}
            </Text>
          </Tooltip>
        </VStack>
        <Separator orientation="vertical" height="48px" />
        <VStack align="start" gap={1}>
          <HoverableBigText fontWeight="500" lineClamp={1} expandable={false}>
            Total Cost
          </HoverableBigText>
          <Box lineClamp={1} whiteSpace="nowrap">
            <FormatMoney
              amount={
                (run.summary.datasetCost ?? 0) +
                (run.summary.evaluationsCost ?? 0)
              }
              currency="USD"
              format="$0.00[00]"
              tooltip={
                <VStack align="start" gap={0}>
                  <Text>
                    Prediction cost:{" "}
                    {run.summary.datasetCost
                      ? formatMoney(
                          {
                            amount: run.summary.datasetCost,
                            currency: "USD",
                          },
                          "$0.00[00]",
                        )
                      : "-"}
                  </Text>
                  <Text>
                    Evaluation cost:{" "}
                    {run.summary.evaluationsCost
                      ? formatMoney(
                          {
                            amount: run.summary.evaluationsCost,
                            currency: "USD",
                          },
                          "$0.00[00]",
                        )
                      : "-"}
                  </Text>
                </VStack>
              }
            />
          </Box>
        </VStack>
        <Separator orientation="vertical" height="48px" />
        <VStack align="start" gap={1}>
          <Text fontWeight="500" lineClamp={1}>
            Runtime
          </Text>
          <Text lineClamp={1} whiteSpace="nowrap">
            {numeral(runtime / 1000).format("00:00:00")}
          </Text>
        </VStack>
        {run.timestamps.stoppedAt && (
          <>
            <Spacer />
            <HStack>
              <Box
                width="12px"
                height="12px"
                background="red.500"
                borderRadius="full"
              />
              <Text>Stopped</Text>
            </HStack>
          </>
        )}
      </HStack>
      {showProgress && !finishedAt && (
        <HStack
          width="full"
          padding={3}
          borderTop="1px solid"
          borderColor="border"
          gap={2}
        >
          <Text whiteSpace="nowrap" marginTop="-1px" paddingX={2}>
            Running
          </Text>
          <EvaluationProgressBar
            evaluationState={{
              progress: run.progress,
              total: run.total,
            }}
            size="lg"
          />
          {onStop && (
            <Button
              colorPalette="red"
              onClick={onStop}
              minHeight="28px"
              minWidth="0"
              paddingY="6px"
              marginLeft="8px"
            >
              <Box paddingX="6px">Stop</Box>
            </Button>
          )}
        </HStack>
      )}
    </VStack>
  );
}

export const getFinishedAt = (
  timestamps: ExperimentRun["timestamps"],
  currentTimestamp: number,
) => {
  if (timestamps.finishedAt) {
    return timestamps.finishedAt;
  }
  if (
    currentTimestamp - new Date(timestamps.updatedAt).getTime() >
    2 * 60 * 1000
  ) {
    return new Date(timestamps.updatedAt).getTime();
  }
  return undefined;
};

export const formatEvaluationSummary = (
  evaluation: {
    averageScore: number | null;
    averagePassed?: number;
  },
  short = false,
): string => {
  return evaluation.averagePassed !== undefined
    ? numeral(evaluation.averagePassed).format("0.[0]%") +
        (short ? " " : " pass") +
        (short || evaluation.averagePassed == evaluation.averageScore
          ? ""
          : ` (${numeral(evaluation.averageScore).format(
              "0.0[0]",
            )} avg. score)`)
    : numeral(evaluation.averageScore).format("0.[00]");
};
