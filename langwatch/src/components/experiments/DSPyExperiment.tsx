import {
  Alert,
  AlertIcon,
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  HStack,
  Heading,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
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
  useDisclosure,
  useTheme,
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import NextLink from "next/link";
import { useRouter } from "next/router";
import numeral from "numeral";
import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "react-feather";
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
import type {
  DSPyRunsSummary,
  DSPyStepSummary,
} from "../../server/experiments/types";
import { api } from "../../utils/api";
import { formatMoney } from "../../utils/formatMoney";
import { formatTimeAgo } from "../../utils/formatTimeAgo";
import { getColorForString } from "../../utils/rotatingColors";
import { MetadataTag } from "../MetadataTag";
import { Discord } from "../icons/Discord";
import { GitHub } from "../icons/GitHub";
import { RenderInputOutput } from "../traces/RenderInputOutput";

export function DSPyExperiment({
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
  const selectedRuns =
    typeof router.query.runIds === "string"
      ? router.query.runIds.split(",")
      : null;
  const [selectedPoint, setSelectedPoint] = useState<{
    runId: string;
    index: string;
  } | null>(null);

  useEffect(() => {
    if (selectedPoint && !selectedRuns?.includes(selectedPoint.runId)) {
      setSelectedPoint(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRuns]);

  const visibleRuns =
    dspyRuns.data && selectedRuns
      ? dspyRuns.data.filter((run) => selectedRuns.includes(run.runId))
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

  const stepToDisplay =
    dspyRuns.data &&
    (
      selectedPoint &&
      dspyRuns.data.find((run) => run.runId === selectedPoint.runId)
    )?.steps.find((step) => step.index === selectedPoint.index);

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

  const nonMatchingRunIds =
    selectedRuns?.filter(
      (runId) => !dspyRuns.data?.some((run) => run.runId === runId)
    ) ?? [];
  const dspyRunsPlusIncoming =
    nonMatchingRunIds.length > 0
      ? ([{ runId: nonMatchingRunIds[0] }, ...(dspyRuns.data ?? [])] as ({
          runId: string;
        } & Partial<DSPyRunsSummary>)[])
      : dspyRuns.data;

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
        spacing={0}
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
          dspyRunsPlusIncoming?.map((run) => {
            const runCost = run.steps
              ?.map((step) => step.llm_calls_summary.total_cost)
              .reduce((acc, cost) => acc + cost, 0);

            return (
              <HStack
                key={run?.runId ?? "new"}
                paddingX={6}
                paddingY={4}
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
                onMouseEnter={() => {
                  if (!selectedRuns?.includes(run.runId)) {
                    setHighlightedRun(run.runId);
                  }
                }}
                onMouseLeave={() => setHighlightedRun(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  const query: Record<string, string | undefined> = {
                    ...router.query,
                    runIds: (selectedRuns?.includes(run.runId)
                      ? selectedRuns.filter((id) => id !== run.runId)
                      : [...(selectedRuns ?? []), run.runId]
                    ).join(","),
                  };
                  if (!query.runIds) {
                    delete query.runIds;
                  }
                  void router.push({ query });
                  setHighlightedRun(null);
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
        <HStack width="full" align="end">
          <Heading as="h1" size="lg">
            {experiment.slug}
          </Heading>
          <Spacer />
          <FeedbackLink />
        </HStack>
        {dspyRuns.isLoading ? (
          <Skeleton width="100%" height="30px" />
        ) : dspyRuns.error ? (
          <Alert status="error">
            <AlertIcon />
            Error loading experiment runs
          </Alert>
        ) : dspyRuns.data?.length === 0 ? (
          <Text>Waiting for the first completed step to arrive...</Text>
        ) : (
          dspyRuns.data && (
            <>
              <Card width="100%">
                <CardHeader>
                  <Heading as="h2" size="md">
                    {optimizerNames.length == 1
                      ? optimizerNames[0]!
                      : optimizerNames.length > 1
                      ? "Multiple Optimizers"
                      : "Waiting for the first completed step to arrive..."}
                  </Heading>
                </CardHeader>
                <CardBody>
                  <DSPyRunsScoresChart
                    dspyRuns={dspyRuns.data}
                    selectedPoint={selectedPoint}
                    setSelectedPoint={setSelectedPoint}
                    highlightedRun={highlightedRun}
                    selectedRuns={selectedRuns}
                    stepToDisplay={stepToDisplay}
                    labelNames={labelNames}
                  />
                </CardBody>
              </Card>
              {stepToDisplay &&
                (!highlightedRun ||
                  highlightedRun === stepToDisplay.run_id) && (
                  <RunDetails
                    project={project}
                    experiment={experiment}
                    dspyStepSummary={stepToDisplay}
                  />
                )}
            </>
          )
        )}
      </VStack>
    </HStack>
  );
}

function FeedbackLink() {
  const { isOpen, onOpen, onClose } = useDisclosure();

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Feedback on DSPy Visualizer</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack align="start" paddingBottom={4}>
              <Text paddingBottom={4}>
                Join our Discord community or open a Github Issue for any
                issues, questions or ideas.
              </Text>
              <NextLink
                href="https://discord.gg/kT4PhDS2gH"
                target="_blank"
                passHref
              >
                <Button as="span" variant="link" leftIcon={<Discord />}>
                  Discord
                </Button>
              </NextLink>
              <NextLink
                href="https://github.com/langwatch/langwatch"
                target="_blank"
                passHref
              >
                <Button as="span" variant="link" leftIcon={<GitHub />}>
                  Github
                </Button>
              </NextLink>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
      <Button
        variant="link"
        onClick={onOpen}
        fontWeight="normal"
        color="gray.800"
      >
        Give Feedback
      </Button>
    </>
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
    dspyStepSummary: DSPyStepSummary;
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
                        <Th width="10%" paddingY={3}>
                          Name
                        </Th>
                        <Th width="25%" paddingY={3}>
                          Instructions
                        </Th>
                        <Th width="25%" paddingY={3}>
                          Signature
                        </Th>
                        <Th width="40%" paddingY={3}>
                          Demonstrations
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
                      ) : dspyStep.data.predictors.length === 0 ? (
                        <Tr>
                          <Td colSpan={5}>No entries</Td>
                        </Tr>
                      ) : dspyStep.data ? (
                        dspyStep.data.predictors.map(
                          ({ name, predictor }, index) => {
                            const signature =
                              predictor?.extended_signature ??
                              predictor?.signature;
                            return (
                              <Tr key={index}>
                                <Td background="gray.50" textAlign="center">
                                  {index + 1}
                                </Td>
                                <Td>{name}</Td>
                                <Td whiteSpace="pre-wrap">
                                  {signature?.instructions ?? "-"}
                                </Td>
                                <Td>
                                  <CollapsableSignature signature={signature} />
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
                                      collapsed={true}
                                    />
                                  ) : (
                                    "-"
                                  )}
                                </Td>
                              </Tr>
                            );
                          }
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
                      <Th width="30%" paddingY={3}>
                        Example
                      </Th>
                      <Th width="50%" paddingY={3}>
                        Prediction
                      </Th>
                      <Th width="20%" paddingY={3}>
                        Score
                      </Th>
                      {hasTrace && (
                        <Th minWidth="200px" paddingY={3}>
                          Trace
                        </Th>
                      )}
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
                        </Tr>
                      ))
                    ) : dspyStep.error ? (
                      <Tr>
                        <Td colSpan={4} color="red.600">
                          Error loading step data
                        </Td>
                      </Tr>
                    ) : dspyStep.data.examples.length === 0 ? (
                      <Tr>
                        <Td colSpan={4}>No entries</Td>
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
                          {hasTrace && (
                            <Td>
                              <RenderInputOutput
                                value={JSON.stringify(example.trace)}
                                collapseStringsAfterLength={140}
                                collapsed={true}
                              />
                            </Td>
                          )}
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
          rightIcon={
            isOpen ? <ChevronUp width="12px" /> : <ChevronDown width="12px" />
          }
        >
          {signature?.signature ?? "-"}
        </Button>
      </HStack>
      {isOpen && signature?.fields ? (
        <RenderInputOutput
          value={JSON.stringify(signature.fields)}
          collapseStringsAfterLength={140}
          collapsed={false}
        />
      ) : null}
    </VStack>
  );
}

function DSPyRunsScoresChart({
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
  const stepsFlattenedByIndex = dspyRuns.reduce(
    (acc, run) => {
      run.steps.forEach((step) => {
        acc[step.index] = {
          ...(acc[step.index] ?? {}),
          index: step.index,
          [run.runId]: step.score,
          [`${run.runId}_label`]: step.label,
        } as { index: string } & Record<string, number>;
      });
      return acc;
    },
    {} as Record<string, { index: string } & Record<string, number>>
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
    index: string;
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
              return [
                numeral(value).format("0.[00]"),
                [name, label].filter((x) => x).join(" "),
              ];
            }}
          />
          {dspyRuns.map(({ runId }) =>
            !selectedRuns ||
            (!!highlightedRun && !selectedRuns.includes(highlightedRun)) ||
            selectedRuns.includes(runId) ? (
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
