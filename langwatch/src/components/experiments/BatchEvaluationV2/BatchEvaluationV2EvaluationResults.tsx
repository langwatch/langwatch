import {
  Alert,
  AlertIcon,
  Box,
  Skeleton,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  Tabs,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  VStack
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import React, { useEffect, useState } from "react";
import type { ESBatchEvaluation } from "../../../server/experiments/types";
import { api } from "../../../utils/api";
import { BatchEvaluationV2EvaluationResult } from "./BatchEvaluationV2EvaluationResult";

export const BatchEvaluationV2EvaluationResults = React.memo(
  function BatchEvaluationV2EvaluationResults({
    project,
    experiment,
    runId,
    isFinished,
    size = "md",
  }: {
    project: Project;
    experiment: Experiment;
    runId: string | undefined;
    isFinished: boolean;
    size?: "sm" | "md";
  }) {
    const [keepRefetching, setKeepRefetching] = useState(true);
    const [tabIndex, setTabIndex] = useState(0);

    const run = api.experiments.getExperimentBatchEvaluationRun.useQuery(
      {
        projectId: project.id,
        experimentSlug: experiment.slug,
        runId: runId ?? "",
      },
      {
        enabled: !!runId,
        refetchInterval: keepRefetching ? 1000 : false,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
      }
    );

    useEffect(() => {
      if (isFinished) {
        setTimeout(() => {
          setKeepRefetching(false);
        }, 2_000);
      } else {
        setKeepRefetching(true);
      }
    }, [isFinished]);

    const datasetByIndex = run.data?.dataset.reduce(
      (acc, item) => {
        acc[item.index] = item;
        return acc;
      },
      {} as Record<number, ESBatchEvaluation["dataset"][number]>
    );

    let resultsByEvaluator = run.data?.evaluations.reduce(
      (acc, evaluation) => {
        if (!acc[evaluation.evaluator]) {
          acc[evaluation.evaluator] = [];
        }
        acc[evaluation.evaluator]!.push(evaluation);
        return acc;
      },
      {} as Record<string, ESBatchEvaluation["evaluations"]>
    );

    resultsByEvaluator = Object.fromEntries(
      Object.entries(resultsByEvaluator ?? {}).sort((a, b) =>
        a[0].localeCompare(b[0])
      )
    );

    if (
      Object.keys(resultsByEvaluator ?? {}).length === 0 &&
      (run.data?.dataset.length ?? 0) > 0
    ) {
      resultsByEvaluator = {
        all: [],
      };
    }

    const [hasScrolled, setHasScrolled] = useState(false);

    if (run.error) {
      return (
        <Alert status="error">
          <AlertIcon />
          Error loading evaluation results
        </Alert>
      );
    }

    if (!resultsByEvaluator || !datasetByIndex) {
      return (
        <VStack spacing={0} width="full" height="full" minWidth="0">
          <Tabs
            size={size}
            width="full"
            height="full"
            display="flex"
            flexDirection="column"
            minHeight="0"
            overflowX="auto"
            padding={0}
          >
            <TabList>
              <Tab>
                <Skeleton width="60px" height="22px" />
              </Tab>
            </TabList>
            <TabPanels
              minWidth="full"
              minHeight="0"
              overflowY="auto"
              onScroll={() => setHasScrolled(true)}
            >
              <TabPanel padding={0}>
                <Table size={size === "sm" ? "xs" : "sm"} variant="grid">
                  <Thead>
                    <Tr>
                      <Th rowSpan={2} width="50px">
                        <Skeleton width="100%" height="52px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                    </Tr>
                    <Tr>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                      <Th>
                        <Skeleton width="100%" height="18px" />
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    <Tr>
                      <Td>
                        <Skeleton width="100%" height="18px" />
                      </Td>
                      <Td>
                        <Skeleton width="100%" height="18px" />
                      </Td>
                      <Td>
                        <Skeleton width="100%" height="18px" />
                      </Td>
                      <Td>
                        <Skeleton width="100%" height="18px" />
                      </Td>
                    </Tr>
                  </Tbody>
                </Table>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </VStack>
      );
    }

    const datasetColumns = new Set(
      Object.values(datasetByIndex).flatMap((item) =>
        Object.keys(item.entry ?? {})
      )
    );

    if (Object.keys(resultsByEvaluator).length === 0) {
      return <Text padding={4}>No results</Text>;
    }

    return (
      <Tabs
        size={size}
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
        minHeight="0"
        overflowX="auto"
        position="relative"
        onChange={(index) => setTabIndex(index)}
        index={tabIndex}
      >
        <Box
          position="absolute"
          top={1}
          right={2}
          color="gray.400"
          fontSize="12px"
        >
          {runId}
        </Box>
        <TabList>
          {Object.entries(resultsByEvaluator).map(([evaluator, results]) => (
            <Tab key={evaluator}>
              {results.find((r) => r.name)?.name ?? evaluator}
            </Tab>
          ))}
        </TabList>
        <TabPanels minWidth="full" minHeight="0" overflowY="auto">
          {Object.entries(resultsByEvaluator).map(
            ([evaluator, results], index) => {
              return (
                <TabPanel
                  key={evaluator}
                  padding={0}
                  minWidth="full"
                  width="fit-content"
                  minHeight="0"
                >
                  {tabIndex === index ? (
                    <BatchEvaluationV2EvaluationResult
                      evaluator={evaluator}
                      results={results}
                      datasetByIndex={datasetByIndex}
                      datasetColumns={datasetColumns}
                      isFinished={isFinished}
                      size={size}
                      hasScrolled={hasScrolled}
                    />
                  ) : null}
                </TabPanel>
              );
            }
          )}
        </TabPanels>
      </Tabs>
    );
  }
);
