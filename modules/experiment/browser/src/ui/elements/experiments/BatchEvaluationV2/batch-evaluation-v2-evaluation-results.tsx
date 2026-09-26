import { Alert, HStack, Skeleton, Spacer, Table, Tabs, Text, VStack } from "@chakra-ui/react";
import { Menu } from "@langwatch/design-system/menu";
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import type { Experiment, Project } from "@langwatch/workflow-contract";
import React, { useState } from "react";
import { Download, ExternalLink, MoreVertical } from "react-feather";

import type { useBatchEvaluationResults } from "../../../../behavior/experiments/use-batch-evaluation-run-results.ts";
import { BatchEvaluationV2EvaluationResult } from "./batch-evaluation-v2-evaluation-result.tsx";

type BatchEvaluationResults = ReturnType<typeof useBatchEvaluationResults>;

export const BatchEvaluationV2EvaluationResults = React.memo(
  function BatchEvaluationV2EvaluationResults({
    project,
    experiment,
    runId,
    isFinished,
    size = "md",
    run,
    datasetByIndex,
    datasetColumns,
    predictedColumns,
    resultsByEvaluator,
    targetsMap,
    downloadCSV,
    isDownloadCSVEnabled,
  }: {
    project: Project;
    experiment: Experiment;
    runId: string | undefined;
    isFinished: boolean;
    size?: "sm" | "md";
    downloadCSV: () => Promise<void>;
    isDownloadCSVEnabled: boolean;
  } & BatchEvaluationResults) {
    // Helper to format tab label for V3 (target + evaluator)
    const getTabLabel = (key: string, results: ExperimentRunWithItems["evaluations"]) => {
      // Check if this is a V3 target:evaluator key
      if (key.includes(":")) {
        const [targetId, evaluator] = key.split(":");
        const target = targetId ? targetsMap.get(targetId) : undefined;
        const targetName = (target as { name?: string } | undefined)?.name ?? targetId;
        const evaluatorName = results.find((r) => r.name)?.name ?? evaluator;
        return `${targetName} - ${evaluatorName}`;
      }
      // V2 style: just evaluator name
      return results.find((r) => r.name)?.name ?? key;
    };

    const [tabIndex, setTabIndex] = useState(0);

    if (run.error) {
      return (
        <Alert.Root status="error">
          <Alert.Indicator />
          Error loading evaluation results
        </Alert.Root>
      );
    }

    if (!resultsByEvaluator || !datasetByIndex) {
      return (
        <VStack gap={0} width="full" height="full" minWidth="0">
          <Tabs.Root
            size={size}
            width="full"
            height="full"
            display="flex"
            flexDirection="column"
            minHeight="0"
            overflowX="auto"
            padding={0}
            colorPalette="blue"
          >
            <Tabs.List>
              <Tabs.Trigger value="skeleton">
                <Skeleton width="60px" height="22px" />
              </Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="skeleton" minWidth="full" minHeight="0" overflowY="auto">
              <Table.Root size={size === "sm" ? "sm" : "md"} variant="outline">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader rowSpan={2} width="50px">
                      <Skeleton width="100%" height="52px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                  </Table.Row>
                  <Table.Row>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                    <Table.ColumnHeader>
                      <Skeleton width="100%" height="18px" />
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  <Table.Row>
                    <Table.Cell>
                      <Skeleton width="100%" height="18px" />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton width="100%" height="18px" />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton width="100%" height="18px" />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton width="100%" height="18px" />
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table.Root>
            </Tabs.Content>
          </Tabs.Root>
        </VStack>
      );
    }

    if (Object.keys(resultsByEvaluator).length === 0) {
      return (
        <Text padding={4}>
          {!isFinished ? "Waiting for the first results to arrive..." : "No results"}
        </Text>
      );
    }

    return (
      <Tabs.Root
        size={size}
        width="full"
        height="full"
        display="flex"
        flexDirection="column"
        minHeight="0"
        position="relative"
        value={Object.keys(resultsByEvaluator)[tabIndex]}
        onValueChange={(change) =>
          setTabIndex(Object.keys(resultsByEvaluator).indexOf(change.value))
        }
        defaultValue={Object.keys(resultsByEvaluator)[0]}
        colorPalette="blue"
      >
        <HStack top={1} right={2} borderBottom="1px solid" borderColor="border">
          <Tabs.List minWidth={0}>
            {Object.entries(resultsByEvaluator).map(([key, results]) => (
              <Tabs.Trigger
                key={key}
                value={key}
                css={{
                  "& span": {
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    minWidth: 0,
                  },
                }}
              >
                {getTabLabel(key, results)}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Spacer />
          <Text color="fg.subtle" fontSize="12px" flexShrink={0}>
            {runId}
          </Text>
          {size === "sm" && (
            <Menu.Root positioning={{ placement: "bottom-end" }}>
              <Menu.Trigger flexShrink={0} paddingRight={1} marginRight={1}>
                <MoreVertical size={16} />
              </Menu.Trigger>
              <Menu.Content>
                <Menu.Item
                  value="open-experiment"
                  onClick={() =>
                    void window.open(
                      `/${project.slug}/experiments/${experiment.slug}?runId=${runId}`,
                      "_blank",
                    )
                  }
                >
                  <ExternalLink size={16} /> Open Experiment Full Page
                </Menu.Item>
                <Menu.Item
                  value="export-csv"
                  onClick={() => void downloadCSV()}
                  disabled={!isDownloadCSVEnabled}
                >
                  <Download size={16} /> Export to CSV
                </Menu.Item>
              </Menu.Content>
            </Menu.Root>
          )}
        </HStack>

        {Object.entries(resultsByEvaluator).map(([evaluator, results], index: number) => {
          return tabIndex === index ? (
            <Tabs.Content
              key={evaluator}
              value={evaluator}
              padding={0}
              minWidth="full"
              minHeight="0"
              overflow="auto"
            >
              <BatchEvaluationV2EvaluationResult
                evaluator={evaluator}
                results={results}
                datasetByIndex={datasetByIndex}
                datasetColumns={datasetColumns}
                predictedColumns={predictedColumns}
                isFinished={isFinished}
                size={size}
                workflowId={experiment.workflowId}
              />
            </Tabs.Content>
          ) : null;
        })}
      </Tabs.Root>
    );
  },
);
