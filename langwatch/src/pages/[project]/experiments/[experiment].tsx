import { DashboardLayout } from "../../../components/DashboardLayout";

import {
  Alert,
  AlertIcon,
  Box,
  Card,
  CardBody,
  CardHeader,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Switch,
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
  VStack,
  useTheme,
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import { useRouter } from "next/router";
import numeral from "numeral";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { MetadataTag } from "../../../components/MetadataTag";
import { RenderInputOutput } from "../../../components/traces/RenderInputOutput";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import type {
  DSPyRunsSummary,
  DSPyStepSummary,
} from "../../../server/experiments/types";
import { api } from "../../../utils/api";
import { formatMoney } from "../../../utils/formatMoney";
import { formatTimeAgo } from "../../../utils/formatTimeAgo";
import { getColorForString } from "../../../utils/rotatingColors";
import React from "react";

export default function ExperimentPage() {
  const router = useRouter();

  const { project } = useOrganizationTeamProject();
  const { experiment: experimentSlug } = router.query;

  const experiment = api.experiments.getExperimentBySlug.useQuery(
    {
      projectId: project?.id ?? "",
      experimentSlug: experimentSlug as string,
    },
    {
      enabled: !!project && typeof experimentSlug === "string",
    }
  );

  return (
    <DashboardLayout>
      {project && experiment.data && (
        <DSPyExperiment project={project} experiment={experiment.data} />
      )}
    </DashboardLayout>
  );
}

function DSPyExperiment({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) {
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
  const selectedRun =
    typeof router.query.runId === "string" ? router.query.runId : null;
  const [selectedRunIndex, setSelectedRunIndex] = useState<{
    runId: string;
    index: number;
  } | null>(null);

  useEffect(() => {
    setSelectedRunIndex(null);
  }, [selectedRun]);

  const visibleRuns =
    dspyRuns.data && selectedRun
      ? [dspyRuns.data.find((run) => run.runId === selectedRun)!].filter(x => x)
      : dspyRuns.data;

  const firstVisibleRun = visibleRuns?.[0];

  useEffect(() => {
    if (!firstVisibleRun || selectedRunIndex !== null) return;

    const lastStep = firstVisibleRun.steps[firstVisibleRun.steps.length - 1];
    lastStep &&
      setSelectedRunIndex({
        runId: firstVisibleRun.runId,
        index: lastStep.index,
      });
  }, [firstVisibleRun, selectedRunIndex]);

  const stepToDisplay =
    dspyRuns.data &&
    (
      selectedRunIndex &&
      dspyRuns.data.find((run) => run.runId === selectedRunIndex.runId)
    )?.steps.find((step) => step.index === selectedRunIndex.index);

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

  return (
    <HStack align="start" width="full" height="full">
      <VStack
        align="start"
        background="white"
        paddingY={4}
        borderRightWidth="1px"
        borderColor="gray.300"
        fontSize="14px"
        minWidth="300px"
        height="full"
        spacing={1}
        onClick={() => {
          const query = { ...router.query };
          delete query.runId;
          void router.push({ query });
        }}
      >
        <Heading as="h2" size="md" paddingX={6} paddingY={4}>
          DSPy Optimizer Runs
        </Heading>
        {dspyRuns.isLoading ? (
          <>
            {Array.from({ length: 3 }).map((_, index) => (
              <HStack key={index} paddingX={6} paddingY={2} width="100%">
                <Skeleton width="100%" height="30px" />
              </HStack>
            ))}
          </>
        ) : dspyRuns.error ? (
          <Alert status="error">
            <AlertIcon />
            Error loading experiment runs
          </Alert>
        ) : dspyRuns.data?.length === 0 ? (
          <Text paddingX={6} paddingY={4}>
            Waiting for runs...
          </Text>
        ) : (
          dspyRuns.data?.map((run) => {
            const runCost = run.steps
              .map((step) => step.llm_calls_summary.total_cost)
              .reduce((acc, cost) => acc + cost, 0);

            return (
              <HStack
                key={run.runId}
                paddingX={6}
                paddingY={4}
                width="100%"
                cursor="pointer"
                role="button"
                opacity={!selectedRun || selectedRun === run.runId ? 1 : 0.5}
                background={selectedRun === run.runId ? "gray.200" : "none"}
                _hover={{
                  background:
                    selectedRun === run.runId ? "gray.200" : "gray.100",
                }}
                onMouseEnter={() => setHighlightedRun(run.runId)}
                onMouseLeave={() => setHighlightedRun(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  const query = {
                    ...router.query,
                    runId: selectedRun === run.runId ? undefined : run.runId,
                  };
                  if (!query.runId) {
                    delete query.runId;
                  }
                  void router.push({ query });
                }}
                spacing={3}
              >
                <Box
                  width="24px"
                  height="24px"
                  background="gray.300"
                  borderRadius="100%"
                  backgroundColor={getColorForString("colors", run.runId).color}
                />
                <VStack align="start" spacing={0}>
                  <Text>{run.runId}</Text>
                  <HStack color="gray.400">
                    <Text>
                      {formatTimeAgo(run.created_at, "yyyy-MM-dd HH:mm", 5)}
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
              </HStack>
            );
          })
        )}
      </VStack>
      <VStack
        align="start"
        width="100%"
        maxWidth="1200px"
        spacing={8}
        padding={6}
      >
        <Heading as="h1" size="lg">
          {experiment.slug}
        </Heading>
        {dspyRuns.isLoading ? (
          <Skeleton width="100%" height="30px" />
        ) : dspyRuns.error ? (
          <Alert status="error">
            <AlertIcon />
            Error loading experiment runs
          </Alert>
        ) : dspyRuns.data?.length === 0 ? (
          <Text>
            No DSPy runs were captured yet, start the optimizer and come back
            here to follow the progress.
          </Text>
        ) : (
          dspyRuns.data && (
            <>
              <Card width="100%">
                <CardHeader>
                  <Heading as="h2" size="md">
                    {optimizerNames.length == 1
                      ? optimizerNames[0]!
                      : "Multiple Optimizers"}
                  </Heading>
                </CardHeader>
                <CardBody>
                  <DSPyRunsScoresChart
                    dspyRuns={dspyRuns.data}
                    selectedRunIndex={selectedRunIndex}
                    setSelectedRunIndex={setSelectedRunIndex}
                    highlightedRun={highlightedRun}
                    selectedRun={selectedRun}
                    stepToDisplay={stepToDisplay}
                    labelNames={labelNames}
                  />
                </CardBody>
              </Card>
              <RunDetails
                project={project}
                experiment={experiment}
                dspyStepSummary={stepToDisplay}
              />
            </>
          )
        )}
      </VStack>
    </HStack>
  );
}

const RunDetails = React.memo(
  function RunDetails({
    project,
    experiment,
    dspyStepSummary,
  }: {
    project: Project;
    experiment: Experiment;
    dspyStepSummary: DSPyStepSummary | undefined;
  }) {
    const dspyStep = api.experiments.getExperimentDSPyStep.useQuery(
      {
        projectId: project.id,
        experimentSlug: experiment.slug,
        runId: dspyStepSummary?.run_id ?? "",
        index: dspyStepSummary?.index ?? 0,
      },
      {
        enabled: !!dspyStepSummary,
      }
    );

    const [tabIndex, setTabIndex] = useState(0);
    const [displayRawParams, setDisplayRawParams] = useState(false);

    if (!dspyStepSummary) {
      return null;
    }

    return (
      <Card width="100%">
        <CardHeader>
          <HStack width="100%" spacing={8}>
            <HStack spacing={3}>
              <Box
                width="24px"
                height="24px"
                borderRadius="100%"
                background={
                  getColorForString("colors", dspyStepSummary.run_id).color
                }
              />
              <Heading as="h2" size="md" marginTop="-1px">
                {dspyStepSummary.run_id} (step {dspyStepSummary.index})
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
                label={dspyStepSummary.label}
                value={numeral(dspyStepSummary.score).format("0.[00]")}
              />
            </HStack>
          </HStack>
        </CardHeader>
        <CardBody paddingTop={0}>
          <Tabs index={tabIndex} onChange={setTabIndex}>
            <TabList position="relative">
              {tabIndex === 0 && (
                <Box position="absolute" top={0} right={0}>
                  <HStack>
                    <Text>Raw</Text>
                    <Switch
                      isChecked={displayRawParams}
                      onChange={() => setDisplayRawParams(!displayRawParams)}
                    />
                  </HStack>
                </Box>
              )}
              <Tab>
                Predictors{" "}
                {dspyStep.data && `(${dspyStep.data.predictors.length})`}
              </Tab>
              <Tab>
                Examples {dspyStep.data && `(${dspyStep.data.examples.length})`}
              </Tab>
              <Tab>
                LLM Calls{" "}
                {dspyStep.data && `(${dspyStep.data.llm_calls.length})`}
              </Tab>
            </TabList>

            <TabPanels>
              <TabPanel
                padding={0}
                paddingTop={displayRawParams ? 4 : 0}
                maxHeight="calc(100vh - 160px)"
                overflowY="auto"
              >
                {dspyStep.isLoading ? (
                  <Skeleton width="100%" height="30px" />
                ) : dspyStep.error ? (
                  <Alert status="error">
                    <AlertIcon />
                    Error loading step data
                  </Alert>
                ) : dspyStep.data && displayRawParams ? (
                  <RenderInputOutput
                    value={JSON.stringify(dspyStep.data?.predictors)}
                    collapseStringsAfterLength={140}
                  />
                ) : dspyStep.data ? (
                  <Table size="sm" variant="grid">
                    <Thead>
                      <Tr>
                        <Th minWidth="15px" maxWidth="15px" paddingY={3}></Th>
                        <Th width="15%" paddingY={3}>
                          Name
                        </Th>
                        <Th width="20%" paddingY={3}>
                          Instructions
                        </Th>
                        <Th width="15%" paddingY={3}>
                          Signature
                        </Th>
                        <Th width="20%" paddingY={3}>
                          Fields
                        </Th>
                        <Th width="30%" paddingY={3}>
                          Demos
                        </Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {dspyStep.isLoading ? (
                        Array.from({ length: 3 }).map((_, index) => (
                          <Tr key={index}>
                            <Td background="gray.50">&nbsp;</Td>
                            <Td>
                              <Skeleton width="100%" height="30px" />
                            </Td>
                            <Td>
                              <Skeleton width="100%" height="30px" />
                            </Td>
                            <Td>
                              <Skeleton width="100%" height="30px" />
                            </Td>
                            <Td>
                              <Skeleton width="100%" height="30px" />
                            </Td>
                            <Td>
                              <Skeleton width="100%" height="30px" />
                            </Td>
                          </Tr>
                        ))
                      ) : dspyStep.error ? (
                        <Tr>
                          <Td colSpan={5} color="red.600">
                            Error loading step data
                          </Td>
                        </Tr>
                      ) : dspyStep.data.predictors.length === 0 ? (
                        <Tr>
                          <Td colSpan={5}>No entries</Td>
                        </Tr>
                      ) : dspyStep.data ? (
                        dspyStep.data.predictors.map(
                          ({ name, predictor }, index) => (
                            <Tr key={index}>
                              <Td background="gray.50" textAlign="center">
                                {index + 1}
                              </Td>
                              <Td>{name}</Td>
                              <Td>
                                {predictor?.signature?.instructions ?? "-"}
                              </Td>
                              <Td>{predictor?.signature?.signature ?? "-"}</Td>
                              <Td>
                                {predictor?.signature?.fields ? (
                                  <RenderInputOutput
                                    value={JSON.stringify(
                                      predictor.signature.fields
                                    )}
                                    collapseStringsAfterLength={140}
                                    collapsed={true}
                                  />
                                ) : (
                                  "-"
                                )}
                              </Td>
                              <Td>
                                {predictor?.demos ? (
                                  <RenderInputOutput
                                    value={JSON.stringify(
                                      predictor.demos.map((demo: any) =>
                                        demo._store ? demo._store : demo
                                      )
                                    )}
                                    collapseStringsAfterLength={140}
                                    groupArraysAfterLength={5}
                                  />
                                ) : (
                                  "-"
                                )}
                              </Td>
                            </Tr>
                          )
                        )
                      ) : null}
                    </Tbody>
                  </Table>
                ) : null}
              </TabPanel>
              <TabPanel
                padding={0}
                maxHeight="calc(100vh - 160px)"
                overflowY="auto"
              >
                <Table size="sm" variant="grid">
                  <Thead>
                    <Tr>
                      <Th minWidth="15px" maxWidth="15px" paddingY={3}></Th>
                      <Th width="35%" paddingY={3}>
                        Example
                      </Th>
                      <Th width="35%" paddingY={3}>
                        Prediction
                      </Th>
                      <Th width="10%" paddingY={3}>
                        Score
                      </Th>
                      <Th width="20%" paddingY={3}>
                        Trace
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {dspyStep.isLoading ? (
                      Array.from({ length: 3 }).map((_, index) => (
                        <Tr key={index}>
                          <Td background="gray.50">&nbsp;</Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                        </Tr>
                      ))
                    ) : dspyStep.error ? (
                      <Tr>
                        <Td colSpan={5} color="red.600">
                          Error loading step data
                        </Td>
                      </Tr>
                    ) : dspyStep.data.examples.length === 0 ? (
                      <Tr>
                        <Td colSpan={5}>No entries</Td>
                      </Tr>
                    ) : dspyStep.data ? (
                      dspyStep.data.examples.map((example, index) => (
                        <Tr key={index}>
                          <Td background="gray.50" textAlign="center">
                            {index + 1}
                          </Td>
                          <Td>
                            <RenderInputOutput
                              value={JSON.stringify(example.example)}
                              collapseStringsAfterLength={140}
                            />
                          </Td>
                          <Td>
                            <RenderInputOutput
                              value={JSON.stringify(example.pred)}
                              collapseStringsAfterLength={140}
                            />
                          </Td>
                          <Td>{example.score}</Td>
                          <Td>
                            <RenderInputOutput
                              value={JSON.stringify(example.trace)}
                              collapseStringsAfterLength={140}
                              collapsed={true}
                            />
                          </Td>
                        </Tr>
                      ))
                    ) : null}
                  </Tbody>
                </Table>
              </TabPanel>
              <TabPanel
                padding={0}
                maxHeight="calc(100vh - 160px)"
                overflowY="auto"
              >
                <Table size="sm" variant="grid">
                  <Thead>
                    <Tr>
                      <Th minWidth="15px" maxWidth="15px" paddingY={3}></Th>
                      <Th width="20%" paddingY={3}>
                        Model
                      </Th>
                      <Th width="35%" paddingY={3}>
                        Response
                      </Th>
                      <Th width="15%" paddingY={3}>
                        Prompt Tokens
                      </Th>
                      <Th width="15%" paddingY={3}>
                        Completion Tokens
                      </Th>
                      <Th width="15%" paddingY={3}>
                        Cost
                      </Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {dspyStep.isLoading ? (
                      Array.from({ length: 3 }).map((_, index) => (
                        <Tr key={index}>
                          <Td background="gray.50">&nbsp;</Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                          <Td>
                            <Skeleton width="100%" height="30px" />
                          </Td>
                        </Tr>
                      ))
                    ) : dspyStep.error ? (
                      <Tr>
                        <Td colSpan={6} color="red.600">
                          Error loading step data
                        </Td>
                      </Tr>
                    ) : dspyStep.data.llm_calls.length === 0 ? (
                      <Tr>
                        <Td colSpan={6}>No entries</Td>
                      </Tr>
                    ) : dspyStep.data ? (
                      dspyStep.data.llm_calls.map((llmCall, index) => {
                        const response =
                          llmCall.response?.choices?.[0]?.message?.content;
                        return (
                          <Tr key={index}>
                            <Td background="gray.50" textAlign="center">
                              {index + 1}
                            </Td>
                            <Td>{llmCall.model}</Td>
                            <Td>
                              {response ? (
                                response
                              ) : (
                                <RenderInputOutput
                                  value={JSON.stringify(llmCall.response)}
                                  collapseStringsAfterLength={140}
                                  collapsed={true}
                                />
                              )}
                            </Td>
                            <Td>{llmCall.prompt_tokens}</Td>
                            <Td>{llmCall.completion_tokens}</Td>
                            <Td>
                              {llmCall.cost
                                ? formatMoney(
                                    { amount: llmCall.cost, currency: "USD" },
                                    "$0.00[0000]"
                                  )
                                : "-"}
                            </Td>
                          </Tr>
                        );
                      })
                    ) : null}
                  </Tbody>
                </Table>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </CardBody>
      </Card>
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

function DSPyRunsScoresChart({
  dspyRuns,
  selectedRunIndex,
  setSelectedRunIndex,
  highlightedRun,
  selectedRun,
  stepToDisplay,
  labelNames,
}: {
  dspyRuns: DSPyRunsSummary[];
  selectedRunIndex: { runId: string; index: number } | null;
  setSelectedRunIndex: (value: { runId: string; index: number } | null) => void;
  highlightedRun: string | null;
  selectedRun: string | null;
  stepToDisplay: DSPyStepSummary | undefined;
  labelNames: string[];
}) {
  const stepsFlattenedByIndex = dspyRuns.reduce(
    (acc, run) => {
      run.steps.forEach((step) => {
        acc[step.index] = {
          ...(acc[step.index] ?? {}),
          index: step.index,
          [run.runId]: step.score,
          [`${run.runId}_label`]: step.label,
        } as { index: number } & Record<string, number>;
      });
      return acc;
    },
    {} as Record<number, { index: number } & Record<string, number>>
  );

  const data = Object.values(stepsFlattenedByIndex);

  const theme = useTheme();
  const getColor = (runId: string) => {
    const [name, number] = getColorForString("colors", runId).color.split(".");
    if (!name || !number) {
      return theme.colors.gray[300];
    }
    return theme.colors[name][number];
  };

  const [hoveredRunIndex, setHoveredRunIndex] = useState<{
    runId: string;
    index: number;
  } | null>(null);

  return (
    <Box width="100%" position="relative">
      {data.length === 0 && (
        <Box
          position="absolute"
          top="50%"
          left="50%"
          transform="translate(-50%, -50%)"
        >
          No data
        </Box>
      )}
      <ResponsiveContainer height={400}>
        <LineChart
          data={data}
          margin={{ top: 20, right: 30, left: 20, bottom: 15 }}
          style={{
            cursor: hoveredRunIndex ? "pointer" : "default",
          }}
          onClick={() => {
            if (
              hoveredRunIndex &&
              (hoveredRunIndex.runId !== selectedRunIndex?.runId ||
                hoveredRunIndex.index !== selectedRunIndex?.index)
            ) {
              setSelectedRunIndex(hoveredRunIndex);
            } else {
              setSelectedRunIndex(null);
            }
          }}
          onMouseMove={(state) => {
            if (state.isTooltipActive) {
              const runId = state.activePayload?.[0]?.name;
              const index = state.activeLabel;
              if (runId && index !== undefined) {
                setHoveredRunIndex({
                  runId,
                  index: parseInt(index),
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
              return [
                numeral(value).format("0.[00]"),
                [name, label].filter((x) => x).join(" "),
              ];
            }}
          />
          {dspyRuns.map(({ runId }) =>
            !selectedRun ||
            (!!highlightedRun && highlightedRun !== selectedRun) ||
            selectedRun === runId ? (
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
                visibility={
                  !highlightedRun || highlightedRun === runId
                    ? "visible"
                    : "hidden"
                }
              />
            ) : null
          )}
          {stepToDisplay && (
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
