import {
  Alert,
  Box,
  Button,
  Card,
  Center,
  Field,
  HStack,
  Heading,
  Separator,
  Skeleton,
  Spacer,
  Spinner,
  Table,
  Tabs,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Experiment, Project, WorkflowVersion } from "@prisma/client";
import type { TRPCClientErrorLike } from "@trpc/client";
import type { UseTRPCQueryResult } from "@trpc/react-query/shared";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/router";
import numeral from "numeral";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "react-feather";
import {
  CartesianGrid,
  Label,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { FormatMoney } from "../../optimization_studio/components/FormatMoney";
import { VersionBox } from "../../optimization_studio/components/History";
import type { AppRouter } from "../../server/api/root";
import type {
  AppliedOptimization,
  AppliedOptimizationField,
  DSPyRunsSummary,
  DSPyStepSummary,
} from "../../server/experiments/types";
import { api } from "../../utils/api";
import { formatMoney } from "../../utils/formatMoney";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { getColorForString } from "../../utils/rotatingColors";
import { titleCase } from "../../utils/stringCasing";
import { FeedbackLink } from "../FeedbackLink";
import { LLMIcon } from "../icons/LLMIcon";
import { MetadataTag } from "../MetadataTag";
import { RenderInputOutput } from "../traces/RenderInputOutput";
import { getRawColorValue } from "../ui/color-mode";
import { Switch } from "../ui/switch";

export function DSPyExperiment({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) {
  const {
    dspyRuns,
    selectedRuns,
    setSelectedRuns,
    highlightedRun,
    setHighlightedRun,
    selectedPoint,
    setSelectedPoint,
    dspyRunsPlusIncoming,
    stepToDisplay,
    optimizerNames,
    labelNames,
    runsById,
  } = useDSPyExperimentState({ project, experiment });

  return (
    <HStack align="start" width="full" height="full" gap={0}>
      <DSPyExperimentRunList
        dspyRuns={dspyRuns}
        selectedRuns={selectedRuns}
        setSelectedRuns={setSelectedRuns}
        setHighlightedRun={setHighlightedRun}
        dspyRunsPlusIncoming={dspyRunsPlusIncoming}
      />
      <Box width="calc(100vw - 391px)" height="full" position="relative">
        <VStack
          align="start"
          width="100%"
          maxWidth="1200px"
          height="full"
          gap={8}
          padding={6}
        >
          <HStack width="full" align="end">
            <Heading as="h1" size="lg">
              {experiment.name ?? experiment.slug}
            </Heading>
            <Spacer />
            <FeedbackLink />
          </HStack>
          {dspyRuns.isLoading ? (
            <Skeleton width="100%" height="30px" />
          ) : dspyRuns.error ? (
            <Alert.Root>
              <Alert.Indicator />
              Error loading experiment runs
            </Alert.Root>
          ) : dspyRuns.data?.length === 0 ? (
            <Text>Waiting for the first completed step to arrive...</Text>
          ) : (
            dspyRuns.data && (
              <>
                <Card.Root width="100%">
                  <Card.Header>
                    <Heading as="h2" size="md">
                      {optimizerNames.length == 1
                        ? optimizerNames[0]!
                        : optimizerNames.length > 1
                        ? "Multiple Optimizers"
                        : "Waiting for the first completed step to arrive..."}
                    </Heading>
                  </Card.Header>
                  <Card.Body>
                    <DSPyRunsScoresChart
                      dspyRuns={dspyRuns.data}
                      selectedPoint={selectedPoint}
                      setSelectedPoint={setSelectedPoint}
                      highlightedRun={highlightedRun}
                      selectedRuns={selectedRuns}
                      stepToDisplay={stepToDisplay}
                      labelNames={labelNames}
                    />
                  </Card.Body>
                </Card.Root>
                {stepToDisplay &&
                  (!highlightedRun ||
                    highlightedRun === stepToDisplay.run_id) && (
                    <Card.Root width="100%">
                      <Card.Body padding={0}>
                        <RunDetails
                          project={project}
                          experiment={experiment}
                          dspyStepSummary={stepToDisplay}
                          workflowVersion={
                            runsById?.[stepToDisplay.run_id]?.workflow_version
                          }
                        />
                      </Card.Body>
                    </Card.Root>
                  )}
              </>
            )
          )}
        </VStack>
        {runsById && selectedRuns?.length === 1 && (
          <DSPyExperimentSummary
            project={project}
            experiment={experiment}
            run={runsById[selectedRuns[0]!]}
          />
        )}
      </Box>
    </HStack>
  );
}

export const useDSPyExperimentState = ({
  project,
  experiment,
  selectedRuns,
  setSelectedRuns,
  incomingRunIds = [],
}: {
  project: Project;
  experiment: Experiment;
  selectedRuns?: string[];
  setSelectedRuns?: (runs: string[]) => void;
  incomingRunIds?: string[];
}) => {
  const dspyRuns = api.experiments.getExperimentDSPyRuns.useQuery(
    {
      projectId: project.id,
      experimentSlug: experiment.slug,
    },
    {
      refetchInterval: 3000,
      refetchOnMount: false,
    }
  );

  const router = useRouter();

  const [highlightedRun, setHighlightedRun] = useState<string | null>(null);

  const selectedRuns_ = useMemo(() => {
    let selectedRuns_ =
      selectedRuns ??
      (typeof router.query.runIds === "string"
        ? router.query.runIds.split(",")
        : null);
    if (!selectedRuns_ || selectedRuns_.length === 0) {
      selectedRuns_ = dspyRuns.data?.[0]?.runId ? [dspyRuns.data[0].runId] : [];
    }
    return selectedRuns_;
  }, [dspyRuns.data, router.query.runIds, selectedRuns]);

  const setSelectedRuns_ = useCallback(
    (runIds: string[]) => {
      if (setSelectedRuns) {
        setSelectedRuns(runIds);
      } else {
        const query: Record<string, string | undefined> = {
          ...router.query,
          runIds: runIds.join(","),
        };
        if (!query.runIds) {
          delete query.runIds;
        }
        void router.push({ query });
      }
    },
    [router, setSelectedRuns]
  );

  const [selectedPoint, setSelectedPoint] = useState<{
    runId: string;
    index: string;
  } | null>(null);

  useEffect(() => {
    if (selectedPoint && !selectedRuns_.includes(selectedPoint.runId)) {
      setSelectedPoint(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRuns_]);

  const visibleRuns =
    dspyRuns.data && selectedRuns_
      ? dspyRuns.data.filter((run) => selectedRuns_.includes(run.runId))
      : dspyRuns.data;

  const firstVisibleRun = visibleRuns?.[0];

  useEffect(() => {
    if (!firstVisibleRun || selectedPoint !== null) return;

    const lastStep = firstVisibleRun.steps[firstVisibleRun.steps.length - 1];
    lastStep &&
      setSelectedPoint({
        runId: firstVisibleRun.runId,
        index: lastStep.index,
      });
  }, [firstVisibleRun, selectedPoint]);

  const runsById = useMemo(() => {
    return dspyRuns.data?.reduce(
      (acc, run) => {
        acc[run.runId] = run;
        return acc;
      },
      {} as Record<string, DSPyRunsSummary>
    );
  }, [dspyRuns.data]);

  const stepToDisplay =
    dspyRuns.data &&
    (selectedPoint && runsById?.[selectedPoint.runId])?.steps.find(
      (step) => step.index === selectedPoint.index
    );

  const optimizerNames = Array.from(
    new Set(
      visibleRuns?.flatMap((run) =>
        run.steps.map((step) => step.optimizer.name)
      ) ?? []
    )
  );
  const labelNames = Array.from(
    new Set(
      visibleRuns?.flatMap((run) => run.steps.map((step) => step.label)) ?? []
    )
  );

  const nonMatchingRunIds = Array.from(
    new Set([...selectedRuns_, ...incomingRunIds])
  ).filter((runId) => !dspyRuns.data?.some((run) => run.runId === runId));
  const dspyRunsPlusIncoming =
    nonMatchingRunIds.length > 0
      ? ([{ runId: nonMatchingRunIds[0] }, ...(dspyRuns.data ?? [])] as ({
          runId: string;
        } & Partial<DSPyRunsSummary>)[])
      : dspyRuns.data;

  return {
    dspyRuns,
    selectedRuns: selectedRuns_,
    setSelectedRuns: setSelectedRuns_,
    highlightedRun,
    setHighlightedRun,
    dspyRunsPlusIncoming,
    stepToDisplay,
    optimizerNames,
    labelNames,
    selectedPoint,
    setSelectedPoint,
    runsById,
  };
};

export function DSPyExperimentRunList({
  dspyRuns,
  selectedRuns,
  setSelectedRuns,
  setHighlightedRun,
  dspyRunsPlusIncoming,
  size = "md",
  incomingRunIds = [],
}: {
  dspyRuns: UseTRPCQueryResult<
    inferRouterOutputs<AppRouter>["experiments"]["getExperimentDSPyRuns"],
    TRPCClientErrorLike<AppRouter>
  >;
  selectedRuns: string[] | null;
  setSelectedRuns: (runs: string[]) => void;
  setHighlightedRun: (runId: string | null) => void;
  dspyRunsPlusIncoming:
    | ({
        runId: string;
      } & Partial<DSPyRunsSummary>)[]
    | undefined;
  size?: "md" | "sm";
  incomingRunIds?: string[];
}) {
  const hasAnyVersion = dspyRunsPlusIncoming?.some(
    (run) => run.workflow_version
  );

  return (
    <VStack
      align="start"
      background="white"
      paddingY={size === "sm" ? 0 : 4}
      borderRightWidth="1px"
      borderColor="gray.300"
      fontSize="14px"
      minWidth={size === "sm" ? "250px" : "300px"}
      maxWidth={size === "sm" ? "250px" : "300px"}
      height="full"
      gap={0}
      overflowY="auto"
    >
      {size !== "sm" && (
        <Heading as="h2" size="md" paddingX={6} paddingY={4}>
          DSPy Optimizer Runs
        </Heading>
      )}
      {dspyRuns.isLoading ? (
        <>
          {Array.from({ length: 3 }).map((_, index) => (
            <HStack key={index} paddingX={6} paddingY={2} width="100%">
              <Skeleton width="100%" height="30px" />
            </HStack>
          ))}
        </>
      ) : dspyRuns.error ? (
        <Alert.Root>
          <Alert.Indicator />
          Error loading experiment runs
        </Alert.Root>
      ) : dspyRuns.data?.length === 0 ? (
        <Text paddingX={6} paddingY={4}>
          Waiting for runs...
        </Text>
      ) : (
        dspyRunsPlusIncoming?.slice(0, 21).map((run) => {
          const runCost = run.steps
            ?.map((step) => step.llm_calls_summary.total_cost)
            .reduce((acc, cost) => acc + cost, 0);
          const runName = run.workflow_version?.commitMessage ?? run.runId;

          return (
            <HStack
              key={run?.runId ?? "new"}
              paddingX={size === "sm" ? 2 : 6}
              paddingY={size === "sm" ? 2 : 4}
              width="100%"
              cursor="pointer"
              role="button"
              opacity={
                !selectedRuns || selectedRuns.includes(run.runId) ? 1 : 0.5
              }
              background={
                selectedRuns?.includes(run.runId) ? "gray.200" : "none"
              }
              _hover={{
                background: selectedRuns?.includes(run.runId)
                  ? "gray.200"
                  : "gray.100",
              }}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                const isHoldingShift = e.shiftKey;

                if (isHoldingShift) {
                  document.getSelection()?.removeAllRanges();
                }

                setSelectedRuns?.(
                  selectedRuns?.includes(run.runId)
                    ? selectedRuns.filter((id) => id !== run.runId)
                    : isHoldingShift
                    ? [...(selectedRuns ?? []), run.runId]
                    : [run.runId]
                );
                setHighlightedRun(null);
              }}
              gap={3}
            >
              {!dspyRuns.data?.find((r) => r.runId === run.runId) ? (
                <>
                  <VersionBox minWidth={hasAnyVersion ? "48px" : "0"} />
                  <VStack align="start" gap={2} width="100%" paddingRight={2}>
                    <HStack width="100%">
                      <Skeleton
                        height="12px"
                        background="gray.400"
                        flexGrow={1}
                      />
                      <Spinner size="xs" flexShrink={0} />
                    </HStack>
                    <Skeleton
                      width="100%"
                      height="12px"
                      background="gray.400"
                    />
                  </VStack>
                </>
              ) : (
                <>
                  {run.workflow_version ? (
                    <VersionBox
                      version={run.workflow_version}
                      minWidth={hasAnyVersion ? "48px" : "0"}
                    />
                  ) : (
                    <Box
                      width="24px"
                      height="24px"
                      minWidth="24px"
                      minHeight="24px"
                      background="gray.300"
                      borderRadius="100%"
                      backgroundColor={
                        getColorForString("colors", run.runId).color
                      }
                    />
                  )}
                  <VStack width="full" align="start" gap={0} paddingRight={2}>
                    <HStack width="full">
                      {run.workflow_version && (
                        <Box
                          width="12px"
                          height="12px"
                          minWidth="12px"
                          minHeight="12px"
                          background="gray.300"
                          borderRadius="100%"
                          backgroundColor={
                            getColorForString("colors", run.runId).color
                          }
                        />
                      )}
                      <Text fontSize={size === "sm" ? "13px" : "14px"}>
                        {runName}
                      </Text>
                      {(incomingRunIds ?? []).includes(run.runId) && (
                        <>
                          <Spacer />
                          <Spinner size="xs" />
                        </>
                      )}
                    </HStack>

                    <HStack
                      color="gray.400"
                      fontSize={size === "sm" ? "12px" : "13px"}
                    >
                      <Text>
                        {run.created_at
                          ? formatTimeAgo(run.created_at, "yyyy-MM-dd HH:mm", 5)
                          : "Waiting for steps..."}
                      </Text>
                      {runCost && (
                        <>
                          <Text>·</Text>
                          <Text>
                            {formatMoney(
                              { amount: runCost, currency: "USD" },
                              "$0.00[0]"
                            )}
                          </Text>
                        </>
                      )}
                    </HStack>
                  </VStack>
                </>
              )}
            </HStack>
          );
        })
      )}
    </VStack>
  );
}

export const RunDetails = React.memo(
  function RunDetails({
    project,
    experiment,
    dspyStepSummary,
    workflowVersion,
    size = "md",
  }: {
    project: Project;
    experiment: Experiment;
    dspyStepSummary: DSPyStepSummary;
    workflowVersion?: WorkflowVersion;
    size?: "md" | "sm";
  }) {
    const dspyStep = api.experiments.getExperimentDSPyStep.useQuery(
      {
        projectId: project.id,
        experimentSlug: experiment.slug,
        runId: dspyStepSummary?.run_id ?? "",
        index: dspyStepSummary?.index ?? "",
      },
      {
        enabled: !!dspyStepSummary,
      }
    );

    const [tabIndex, setTabIndex] = useState(0);
    const [displayRawParams, setDisplayRawParams] = useState(false);
    const hasTrace = dspyStep.data?.examples.some((example) => example.trace);
    const runName = workflowVersion?.commitMessage ?? dspyStepSummary.run_id;

    return (
      <VStack width="full" height="full" gap={0} minWidth="0">
        {size !== "sm" && (
          <HStack width="full" gap={8} padding={4}>
            <HStack gap={3}>
              {workflowVersion ? (
                <>
                  <VersionBox version={workflowVersion} />
                  <Box
                    width="18px"
                    height="18px"
                    background="gray.300"
                    borderRadius="100%"
                    backgroundColor={
                      getColorForString("colors", dspyStepSummary.run_id).color
                    }
                  />
                </>
              ) : (
                <Box
                  width="24px"
                  height="24px"
                  borderRadius="100%"
                  background={
                    getColorForString("colors", dspyStepSummary.run_id).color
                  }
                />
              )}
              <Heading as="h2" size="md" marginTop="-1px">
                {runName} (step {dspyStepSummary.index})
              </Heading>
            </HStack>
            <Spacer />
            <HStack>
              <MetadataTag
                label="Step Cost"
                value={formatMoney(
                  {
                    amount: dspyStepSummary.llm_calls_summary.total_cost,
                    currency: "USD",
                  },
                  "$0.00[00]"
                )}
              />
              <MetadataTag
                label="Step Tokens"
                value={numeral(
                  dspyStepSummary.llm_calls_summary.total_tokens
                ).format("0a")}
              />
              <MetadataTag
                label={
                  dspyStepSummary.label === "score"
                    ? "Step " + titleCase(dspyStepSummary.label)
                    : titleCase(dspyStepSummary.label)
                }
                value={numeral(dspyStepSummary.score).format("0.[00]")}
              />
            </HStack>
          </HStack>
        )}
        <Tabs.Root
          value={tabIndex.toString()}
          onValueChange={(e) => setTabIndex(parseInt(e.value))}
          size={size}
          width="full"
          height="full"
          display="flex"
          flexDirection="column"
          minWidth="0"
          colorPalette="blue"
        >
          <Tabs.List
            position="relative"
            overflowX="auto"
            overflowY="hidden"
            whiteSpace="nowrap"
          >
            {size === "sm" && (
              <Center
                minHeight="31px"
                marginBottom="-2px"
                paddingX={4}
                fontWeight={500}
                color="gray.500"
                background="gray.100"
              >
                <Text>Step {dspyStepSummary.index}</Text>
              </Center>
            )}
            {tabIndex === 0 && size !== "sm" && (
              <Box position="absolute" top={0} right={4}>
                <HStack>
                  <Text>Raw</Text>
                  <Field.Root>
                    <Switch
                      checked={displayRawParams}
                      onChange={() => setDisplayRawParams(!displayRawParams)}
                    />
                  </Field.Root>
                </HStack>
              </Box>
            )}
            <Tabs.Trigger value="0">
              Predictors{" "}
              {dspyStep.data && `(${dspyStep.data.predictors.length})`}
            </Tabs.Trigger>
            <Tabs.Trigger value="1">
              Evaluations{" "}
              {dspyStep.data && `(${dspyStep.data.examples.length})`}
            </Tabs.Trigger>
            <Tabs.Trigger value="2">
              LLM Calls {dspyStep.data && `(${dspyStep.data.llm_calls.length})`}
            </Tabs.Trigger>
            {size === "sm" && (
              <>
                <Spacer />
                <HStack
                  paddingX={4}
                  color="gray.500"
                  fontSize="12px"
                  textTransform="uppercase"
                >
                  <Text>
                    Step Cost:{" "}
                    {formatMoney(
                      {
                        amount: dspyStepSummary.llm_calls_summary.total_cost,
                        currency: "USD",
                      },
                      "$0.00[00]"
                    )}
                  </Text>
                  <Separator orientation="vertical" />
                  <Text>
                    Step Tokens:{" "}
                    {numeral(
                      dspyStepSummary.llm_calls_summary.total_tokens
                    ).format("0a")}
                  </Text>
                  <Separator orientation="vertical" />
                  <Text>
                    {dspyStepSummary.label === "score"
                      ? "Step " + dspyStepSummary.label
                      : dspyStepSummary.label}
                    : {numeral(dspyStepSummary.score).format("0.[00]")}
                  </Text>
                </HStack>
              </>
            )}
          </Tabs.List>

          <Tabs.Content
            value="0"
            width="full"
            height="full"
            minWidth="0"
            overflowX="auto"
            display="flex"
            padding={0}
            paddingTop={displayRawParams ? 4 : 0}
          >
            {dspyStep.isLoading ? (
              <Skeleton width="100%" height="30px" />
            ) : dspyStep.error ? (
              <Alert.Root>
                <Alert.Indicator />
                Error loading step data
              </Alert.Root>
            ) : dspyStep.data && displayRawParams ? (
              <RenderInputOutput
                value={JSON.stringify(dspyStep.data?.predictors)}
                collapseStringsAfterLength={140}
              />
            ) : dspyStep.data ? (
              <Table.Root
                height="fit-content"
                // @ts-ignore
                size={size === "sm" ? "xs" : "sm"}
                // @ts-ignore
                variant="grid"
              >
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader
                      minWidth="15px"
                      maxWidth="15px"
                      paddingY={3}
                    ></Table.ColumnHeader>
                    <Table.ColumnHeader width="10%" paddingY={3}>
                      Name
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="25%" paddingY={3}>
                      Instructions
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="25%" paddingY={3}>
                      Signature
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="40%" paddingY={3}>
                      Demonstrations
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {dspyStep.isLoading ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <Table.Row key={index}>
                        <Table.Cell background="gray.50">&nbsp;</Table.Cell>
                        <Table.Cell>
                          <Skeleton width="100%" height="30px" />
                        </Table.Cell>
                        <Table.Cell>
                          <Skeleton width="100%" height="30px" />
                        </Table.Cell>
                        <Table.Cell>
                          <Skeleton width="100%" height="30px" />
                        </Table.Cell>
                        <Table.Cell>
                          <Skeleton width="100%" height="30px" />
                        </Table.Cell>
                      </Table.Row>
                    ))
                  ) : dspyStep.error ? (
                    <Table.Row>
                      <Table.Cell colSpan={5} color="red.600">
                        Error loading step data
                      </Table.Cell>
                    </Table.Row>
                  ) : dspyStep.data.predictors.length === 0 ? (
                    <Table.Row>
                      <Table.Cell colSpan={5}>No entries</Table.Cell>
                    </Table.Row>
                  ) : dspyStep.data ? (
                    dspyStep.data.predictors.map(
                      ({ name, predictor }, index) => {
                        const signature =
                          predictor?.extended_signature ?? predictor?.signature;
                        return (
                          <Table.Row key={index}>
                            <Table.Cell background="gray.50" textAlign="center">
                              {index + 1}
                            </Table.Cell>
                            <Table.Cell>{name}</Table.Cell>
                            <Table.Cell whiteSpace="pre-wrap">
                              {signature?.instructions ?? "-"}
                            </Table.Cell>
                            <Table.Cell>
                              <CollapsableSignature signature={signature} />
                            </Table.Cell>
                            <Table.Cell>
                              {predictor?.demos ? (
                                <RenderInputOutput
                                  value={JSON.stringify(
                                    predictor.demos.map((demo: any) =>
                                      demo._store ? demo._store : demo
                                    )
                                  )}
                                  collapseStringsAfterLength={140}
                                  shouldCollapse={(field) => {
                                    return field.type === "array";
                                  }}
                                  displayObjectSize={true}
                                />
                              ) : (
                                "-"
                              )}
                            </Table.Cell>
                          </Table.Row>
                        );
                      }
                    )
                  ) : null}
                </Table.Body>
              </Table.Root>
            ) : null}
          </Tabs.Content>
          <Tabs.Content
            value="1"
            width="full"
            height="full"
            minWidth="0"
            overflowX="auto"
            display="flex"
            padding={0}
          >
            {tabIndex === 1 && (
              <Table.Root
                height="fit-content"
                // @ts-ignore
                size={size === "sm" ? "xs" : "sm"}
                // @ts-ignore
                variant="grid"
              >
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader
                      minWidth="15px"
                      maxWidth="15px"
                      paddingY={3}
                    ></Table.ColumnHeader>
                    <Table.ColumnHeader width="30%" paddingY={3}>
                      Example
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="50%" paddingY={3}>
                      Prediction
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="20%" paddingY={3}>
                      Score
                    </Table.ColumnHeader>
                    {hasTrace && (
                      <Table.ColumnHeader minWidth="200px" paddingY={3}>
                        Trace
                      </Table.ColumnHeader>
                    )}
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {dspyStep.isLoading ? (
                    Array.from({ length: 3 }).map((_, index) => (
                      <Table.Row key={index}>
                        <Table.Cell background="gray.50">&nbsp;</Table.Cell>
                        <Table.Cell>
                          <Skeleton width="100%" height="30px" />
                        </Table.Cell>
                        <Table.Cell>
                          <Skeleton width="100%" height="30px" />
                        </Table.Cell>
                        <Table.Cell>
                          <Skeleton width="100%" height="30px" />
                        </Table.Cell>
                      </Table.Row>
                    ))
                  ) : dspyStep.error ? (
                    <Table.Row>
                      <Table.Cell colSpan={4} color="red.600">
                        Error loading step data
                      </Table.Cell>
                    </Table.Row>
                  ) : dspyStep.data.examples.length === 0 ? (
                    <Table.Row>
                      <Table.Cell colSpan={4}>No entries</Table.Cell>
                    </Table.Row>
                  ) : dspyStep.data ? (
                    dspyStep.data.examples.map((example, index) => (
                      <Table.Row key={index}>
                        <Table.Cell background="gray.50" textAlign="center">
                          {index + 1}
                        </Table.Cell>
                        <Table.Cell>
                          <RenderInputOutput
                            value={JSON.stringify(example.example)}
                            collapseStringsAfterLength={140}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          <RenderInputOutput
                            value={JSON.stringify(example.pred)}
                            collapseStringsAfterLength={140}
                          />
                        </Table.Cell>
                        <Table.Cell>{example.score}</Table.Cell>
                        {hasTrace && (
                          <Table.Cell>
                            <RenderInputOutput
                              value={JSON.stringify(example.trace)}
                              collapseStringsAfterLength={140}
                              collapsed={true}
                            />
                          </Table.Cell>
                        )}
                      </Table.Row>
                    ))
                  ) : null}
                </Table.Body>
              </Table.Root>
            )}
          </Tabs.Content>
          <Tabs.Content
            value="2"
            width="full"
            height="full"
            minWidth="0"
            overflowX="auto"
            display="flex"
            padding={0}
          >
            <Table.Root
              height="fit-content"
              // @ts-ignore
              size={size === "sm" ? "xs" : "sm"}
              // @ts-ignore
              variant="grid"
            >
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader
                    minWidth="15px"
                    maxWidth="15px"
                    paddingY={3}
                  ></Table.ColumnHeader>
                  <Table.ColumnHeader width="20%" paddingY={3}>
                    Model
                  </Table.ColumnHeader>
                  <Table.ColumnHeader width="25%" paddingY={3}>
                    Messages
                  </Table.ColumnHeader>
                  <Table.ColumnHeader width="45%" paddingY={3}>
                    Response
                  </Table.ColumnHeader>
                  <Table.ColumnHeader width="10%" paddingY={3}>
                    Cost
                  </Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {dspyStep.isLoading ? (
                  Array.from({ length: 3 }).map((_, index) => (
                    <Table.Row key={index}>
                      <Table.Cell background="gray.50">&nbsp;</Table.Cell>
                      <Table.Cell>
                        <Skeleton width="100%" height="30px" />
                      </Table.Cell>
                      <Table.Cell>
                        <Skeleton width="100%" height="30px" />
                      </Table.Cell>
                      <Table.Cell>
                        <Skeleton width="100%" height="30px" />
                      </Table.Cell>
                      <Table.Cell>
                        <Skeleton width="100%" height="30px" />
                      </Table.Cell>
                    </Table.Row>
                  ))
                ) : dspyStep.error ? (
                  <Table.Row>
                    <Table.Cell colSpan={6} color="red.600">
                      Error loading step data
                    </Table.Cell>
                  </Table.Row>
                ) : dspyStep.data.llm_calls.length === 0 ? (
                  <Table.Row>
                    <Table.Cell colSpan={6}>No entries</Table.Cell>
                  </Table.Row>
                ) : dspyStep.data ? (
                  dspyStep.data.llm_calls.map((llmCall, index) => {
                    const response =
                      llmCall.response?.choices?.[0]?.message?.content ??
                      llmCall.response?.output;
                    return (
                      <Table.Row key={index}>
                        <Table.Cell background="gray.50" textAlign="center">
                          {index + 1}
                        </Table.Cell>
                        <Table.Cell>{llmCall.model}</Table.Cell>
                        <Table.Cell>
                          <RenderInputOutput
                            value={JSON.stringify(
                              llmCall.response?.prompt ??
                                llmCall.response?.messages
                            )}
                            collapseStringsAfterLength={140}
                            collapsed={true}
                          />
                        </Table.Cell>
                        <Table.Cell>
                          {response ? (
                            response
                          ) : (
                            <RenderInputOutput
                              value={JSON.stringify(llmCall.response)}
                              collapseStringsAfterLength={140}
                              collapsed={true}
                            />
                          )}
                        </Table.Cell>
                        <Table.Cell>
                          {llmCall.cost ? (
                            formatMoney(
                              { amount: llmCall.cost, currency: "USD" },
                              "$0.00[0000]"
                            )
                          ) : llmCall.response.cached ? (
                            <HStack align="start">
                              <Text>$0.00</Text>
                              <Text color="gray.400">(cached)</Text>
                            </HStack>
                          ) : (
                            "-"
                          )}
                        </Table.Cell>
                      </Table.Row>
                    );
                  })
                ) : null}
              </Table.Body>
            </Table.Root>
          </Tabs.Content>
        </Tabs.Root>
      </VStack>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.project.id === nextProps.project.id &&
      prevProps.experiment.slug === nextProps.experiment.slug &&
      prevProps.dspyStepSummary?.run_id === nextProps.dspyStepSummary?.run_id &&
      prevProps.dspyStepSummary?.index === nextProps.dspyStepSummary?.index
    );
  }
);

function CollapsableSignature({
  signature,
}: {
  signature: Record<string, any> | undefined;
}) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <VStack>
      <HStack>
        <Button
          size="sm"
          fontSize="14px"
          fontWeight="normal"
          variant="ghost"
          onClick={() => setIsOpen(!isOpen)}
        >
          {signature?.signature ?? "-"}
          {isOpen ? <ChevronUp width="12px" /> : <ChevronDown width="12px" />}
        </Button>
      </HStack>
      {isOpen && signature?.fields ? (
        <RenderInputOutput
          value={JSON.stringify(
            Object.fromEntries(
              Object.entries(signature.fields).map(([key, value]) => {
                return [
                  key,
                  Object.fromEntries(
                    Object.entries(value as any).filter(
                      ([key]) => key !== "__class__"
                    )
                  ),
                ];
              })
            )
          )}
          collapseStringsAfterLength={140}
          collapsed={false}
        />
      ) : null}
    </VStack>
  );
}

export function DSPyRunsScoresChart({
  dspyRuns,
  selectedPoint,
  setSelectedPoint,
  highlightedRun,
  selectedRuns,
  stepToDisplay,
  labelNames,
}: {
  dspyRuns: DSPyRunsSummary[];
  selectedPoint: { runId: string; index: string } | null;
  setSelectedPoint: (value: { runId: string; index: string } | null) => void;
  highlightedRun: string | null;
  selectedRuns: string[] | null;
  stepToDisplay: DSPyStepSummary | undefined;
  labelNames: string[];
}) {
  const runIsVisible = (runId: string) =>
    (!selectedRuns && !highlightedRun) ||
    (!!highlightedRun && highlightedRun === runId) ||
    (!highlightedRun && !!selectedRuns && selectedRuns.includes(runId));

  const stepsFlattenedByIndex = dspyRuns.reduce(
    (acc, run) => {
      if (!runIsVisible(run.runId)) return acc;
      run.steps.forEach((step) => {
        acc[step.index] = {
          ...(acc[step.index] ?? {}),
          index: step.index,
          [run.runId]: step.score,
          [`${run.runId}_label`]: step.label,
          [`${run.runId}_version`]: run.workflow_version?.version,
        } as { index: string } & Record<string, number>;
      });
      return acc;
    },
    {} as Record<string, { index: string } & Record<string, number>>
  );

  const data = Object.values(stepsFlattenedByIndex).sort((a, b) => {
    const aParts = a.index.split(".").map(Number);
    const bParts = b.index.split(".").map(Number);

    for (let i = 0; i < 3; i++) {
      const aPart = aParts[i] ?? 0;
      const bPart = bParts[i] ?? 0;
      if (aPart < bPart) return -1;
      if (aPart > bPart) return 1;
    }

    return 0;
  });

  const getColor = (runId: string) => {
    const [name, number] = getColorForString("colors", runId).color.split(".");
    if (!name || !number) {
      return getRawColorValue("gray.300");
    }

    return getRawColorValue(`${name}.${number}`);
  };

  const [hoveredRunIndex, setHoveredRunIndex] = useState<{
    runId: string;
    index: string;
  } | null>(null);

  const firstSelectedRun = selectedRuns?.[0];

  const bestScore = useMemo(() => {
    return data.reduce(
      (best, point) => {
        const score = point[firstSelectedRun ?? ""];
        if (score === undefined) {
          return best;
        }
        return score > best.score ? { score, index: point.index } : best;
      },
      { score: -Infinity, index: "" }
    );
  }, [data, firstSelectedRun]);

  return (
    <Box width="100%" position="relative">
      {data.length === 0 && (
        <Box
          position="absolute"
          top="50%"
          left="50%"
          transform="translate(-50%, -50%)"
        >
          It can take up to 5 minutes for the first steps to arrive,
          <br />
          check the logs for progress meanwhile
        </Box>
      )}
      <ResponsiveContainer height={300}>
        <LineChart
          data={data}
          margin={{ top: 28, right: 30, left: 20, bottom: 15 }}
          style={{
            cursor: hoveredRunIndex ? "pointer" : "default",
          }}
          onClick={() => {
            if (
              hoveredRunIndex &&
              (hoveredRunIndex.runId !== selectedPoint?.runId ||
                hoveredRunIndex.index !== selectedPoint?.index)
            ) {
              setSelectedPoint(hoveredRunIndex);
            } else {
              setSelectedPoint(null);
            }
          }}
          onMouseMove={(state) => {
            if (state.isTooltipActive) {
              const runId = state.activePayload?.[0]?.name;
              const index = state.activeLabel;
              if (runId && index !== undefined) {
                setHoveredRunIndex({
                  runId,
                  index,
                });
              } else {
                setHoveredRunIndex(null);
              }
            } else {
              setHoveredRunIndex(null);
            }
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="index"
            name="Step"
            label={{
              value: "Step",
              position: "insideBottomRight",
              offset: -10,
            }}
          />
          <YAxis
            type="number"
            name={labelNames.length == 1 ? labelNames[0] : "Score"}
            label={{
              value: labelNames.length == 1 ? labelNames[0] : "Score",
              angle: -90,
              position: "insideLeft",
              offset: -5,
              style: { textAnchor: "middle" },
            }}
          />
          <Tooltip
            labelFormatter={(value) => `Step ${value}`}
            formatter={(value, name, props) => {
              const label = props.payload[`${name}_label`];
              const version = props.payload[`${name}_version`];
              return [
                numeral(value).format("0.[00]"),
                [version ? `[${version}]` : name, label]
                  .filter((x) => x)
                  .join(" "),
              ];
            }}
          />
          {bestScore.index && (
            <ReferenceDot
              x={bestScore.index}
              y={bestScore.score}
              r={8}
              fill="gold"
              stroke="none"
            >
              <Label
                value="Best"
                position="top"
                offset={10}
                fill={getRawColorValue("gray.700")}
                fontSize="12px"
              />
            </ReferenceDot>
          )}
          {dspyRuns.map(({ runId }) =>
            runIsVisible(runId) ? (
              <Line
                key={runId}
                type="monotone"
                dataKey={runId}
                stroke={getColor(runId)}
                name={runId}
                dot={{
                  r: 5,
                  fill: getColor(runId),
                }}
                isAnimationActive={false}
              />
            ) : null
          )}
          {stepToDisplay &&
            (!highlightedRun || highlightedRun === stepToDisplay.run_id) && (
              <ReferenceDot
                x={stepToDisplay.index}
                y={
                  stepsFlattenedByIndex[stepToDisplay.index]?.[
                    stepToDisplay.run_id
                  ]
                }
                stroke={getColor(stepToDisplay.run_id)}
                fill={getColor(stepToDisplay.run_id)}
              />
            )}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  );
}

export function DSPyExperimentSummary({
  project,
  experiment,
  run,
  onApply,
  onViewLogs,
}: {
  project: Project;
  experiment: Experiment;
  run:
    | NonNullable<
        UseTRPCQueryResult<
          inferRouterOutputs<AppRouter>["experiments"]["getExperimentDSPyRuns"],
          TRPCClientErrorLike<AppRouter>
        >["data"]
      >[number]
    | undefined;
  onApply?: (appliedOptimizations: AppliedOptimization[]) => void;
  onViewLogs?: () => void;
}) {
  const { totalCost, bestScore, bestScoreStepSummary, bestScoreLabel } =
    useMemo(() => {
      const totalCost = run?.steps
        ?.map((step) => step.llm_calls_summary.total_cost)
        .reduce((acc, cost) => acc + cost, 0);
      const bestScore = run?.steps
        ?.map((step) => step.score)
        .reduce((acc, score) => (score > acc ? score : acc), 0);
      const bestScoreStepSummary = run?.steps?.find(
        (step) => step.score === bestScore
      );
      const bestScoreLabel = bestScoreStepSummary?.label;

      return { totalCost, bestScore, bestScoreStepSummary, bestScoreLabel };
    }, [run]);

  const bestScoreStep = api.experiments.getExperimentDSPyStep.useQuery(
    {
      projectId: project.id,
      experimentSlug: experiment.slug,
      runId: bestScoreStepSummary?.run_id ?? "",
      index: bestScoreStepSummary?.index ?? "",
    },
    {
      enabled: !!bestScoreStepSummary && !!onApply,
    }
  );

  return (
    <HStack
      position="sticky"
      left={0}
      bottom={0}
      width="100%"
      background="white"
      borderTop="1px solid"
      borderColor="gray.200"
      paddingY={4}
      paddingX={6}
      gap={5}
    >
      <VStack align="start" gap={1}>
        <Text fontWeight="500" lineClamp={1}>
          {!bestScoreLabel || bestScoreLabel === "score"
            ? "Best Score"
            : titleCase(bestScoreLabel)}
        </Text>
        <Text lineClamp={1} whiteSpace="nowrap">
          {numeral(bestScore).format("0.[00]")}
        </Text>
      </VStack>
      <Separator orientation="vertical" height="48px" />
      <VStack align="start" gap={1}>
        <Text fontWeight="500" lineClamp={1}>
          Total Cost
        </Text>
        <Text lineClamp={1} whiteSpace="nowrap">
          {run && totalCost ? (
            <FormatMoney amount={totalCost} currency="USD" format="$0.00[00]" />
          ) : (
            "-"
          )}
        </Text>
      </VStack>
      <Spacer />
      {onViewLogs && (
        <Button size="sm" onClick={onViewLogs} variant="ghost">
          View Logs
        </Button>
      )}
      {bestScoreStep.data && onApply && (
        <Button
          size="md"
          colorPalette="green"
          onClick={() => {
            if (!bestScoreStep.data) return;
            const appliedOptimizations: AppliedOptimization[] =
              bestScoreStep.data.predictors.map((predictor) => {
                const optimization: AppliedOptimization = {
                  id: predictor.name,
                  instructions:
                    predictor.predictor.extended_signature?.instructions ??
                    predictor.predictor.signature?.instructions,
                  fields: Object.entries(
                    predictor.predictor.signature?.fields ?? {}
                  ).map(([key, value]: [string, any]) => {
                    const field: AppliedOptimizationField = {
                      identifier: key,
                      field_type: value.field_type ?? "input",
                      prefix: value.prefix,
                      desc: value.desc,
                    };

                    return field;
                  }),
                  demonstrations: predictor.predictor.demos
                    ?.map((demo: any) => demo._store ?? demo)
                    .filter(Boolean),
                };
                return optimization;
              });

            if (onApply) {
              onApply(appliedOptimizations);
            }
          }}
        >
          <LLMIcon /> Apply Optimization
        </Button>
      )}
    </HStack>
  );
}
