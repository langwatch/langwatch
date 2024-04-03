import {
  Alert,
  AlertIcon,
  Button,
  Card,
  CardBody,
  CardHeader,
  HStack,
  Heading,
  Input,
  InputGroup,
  InputLeftElement,
  Skeleton,
  Spacer,
  Spinner,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
  useTheme,
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { Pause, Play, RefreshCw, Search } from "react-feather";
import { type UseFormReturn } from "react-hook-form";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { elasticSearchSpanToSpan } from "../../server/tracer/types";
import { type SingleEvaluationResult } from "../../trace_checks/evaluators.generated";
import { getEvaluatorDefinitions } from "../../trace_checks/getEvaluator";
import { evaluatePreconditions } from "../../trace_checks/preconditions";
import { api } from "../../utils/api";
import { useDrawer } from "../CurrentDrawer";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { FilterSidebar } from "../filters/FilterSidebar";
import { FilterToggle } from "../filters/FilterToggle";
import type { CheckConfigFormData } from "./CheckConfigForm";
import { checkStatusColorMap } from "./EvaluationStatus";
import { useDebounceValue } from "usehooks-ts";
import type { CheckPreconditions } from "../../trace_checks/types";

export function TryItOut({
  form,
}: {
  form: UseFormReturn<CheckConfigFormData, any, undefined>;
}) {
  const { project } = useOrganizationTeamProject();
  const { watch } = form;
  const theme = useTheme();
  const gray400 = theme.colors.gray["400"];

  const evaluatorType = watch("checkType");
  const preconditions = watch("preconditions");
  const settings = watch("settings");
  const evaluatorDefinition =
    evaluatorType && getEvaluatorDefinitions(evaluatorType);

  const [query, setQuery] = useDebounceValue("", 300);
  const {
    period: { startDate, endDate },
    setPeriod,
  } = usePeriodSelector();
  const { filterParams } = useFilterParams();
  const { openDrawer } = useDrawer();
  const [randomSeed, setRandomSeed] = useState<number>(Math.random() * 1000);
  const [fetchingPreconditions, setFetchingPreconditions] =
    useState<CheckPreconditions>([]);

  const tracesPassingPreconditionsOnLoad = api.traces.getSampleTraces.useQuery(
    {
      ...filterParams,
      query: query,
      evaluatorType: evaluatorType!,
      preconditions: fetchingPreconditions,
      expectedResults: 10,
      sortBy: `random.${randomSeed}`,
    },
    {
      enabled: !!filterParams.projectId && !!evaluatorType,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  const allPassing =
    tracesPassingPreconditionsOnLoad.data?.every(
      (trace) => trace.passesPreconditions
    ) ?? false;

  const tracesLivePassesPreconditions =
    tracesPassingPreconditionsOnLoad.data?.map(
      (trace) =>
        evaluatorType &&
        evaluatePreconditions(
          evaluatorType,
          trace,
          trace.spans?.map(elasticSearchSpanToSpan) ?? [],
          preconditions
        )
    ) ?? [];
  const firstPassingPrecondition = tracesLivePassesPreconditions.findIndex(
    (pass) => pass
  );

  const [runningResults, setRunningResults] = useState<
    Record<string, { status: "loading" } | SingleEvaluationResult>
  >({});
  const [runningState, setRunningState] = useState<
    { state: "idle" } | { state: "paused" | "running"; nextTraceId: string }
  >({ state: "idle" });

  const runEvaluation = api.evaluations.runEvaluation.useMutation();

  useEffect(() => {
    setRunningResults({});
    setRunningState({ state: "idle" });
  }, [tracesPassingPreconditionsOnLoad.data]);

  useEffect(() => {
    if (!project || !evaluatorType || runningState.state !== "running") return;

    setRunningResults((prev) => ({
      ...prev,
      [runningState.nextTraceId]: { status: "loading" },
    }));

    const moveToNext = () => {
      const processedTraceIds = [
        ...Object.keys(runningResults),
        runningState.nextTraceId,
      ];
      const nextIndex = tracesLivePassesPreconditions.findIndex(
        (passes, index) =>
          passes &&
          !processedTraceIds.includes(
            tracesPassingPreconditionsOnLoad.data?.[index]?.trace_id ?? ""
          )
      );

      const nextTraceId =
        tracesPassingPreconditionsOnLoad.data?.[nextIndex]?.trace_id;

      if (!nextTraceId) {
        setRunningState({ state: "idle" });
        return;
      }

      setRunningState((runningState) => ({
        ...runningState,
        nextTraceId: nextTraceId,
      }));
    };

    runEvaluation.mutate(
      {
        projectId: project.id,
        evaluatorType: evaluatorType,
        traceId: runningState.nextTraceId,
        settings,
      },
      {
        onSuccess: (result) => {
          setRunningResults((prev) => ({
            ...prev,
            [runningState.nextTraceId]: result,
          }));

          moveToNext();
        },
        onError: (err) => {
          setRunningResults((prev) => ({
            ...prev,
            [runningState.nextTraceId]: {
              status: "error",
              error_type: typeof err,
              message: err.message,
              traceback: [],
            },
          }));

          moveToNext();
        },
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningState.state, (runningState as any).nextTraceId]);

  return (
    <VStack width="full" spacing={6} marginTop={6}>
      <HStack width="full" align="end">
        <Heading as="h2" size="lg" textAlign="center" paddingTop={4}>
          Try it out
        </Heading>
        <Spacer />
        <InputGroup maxWidth="350px" borderColor="gray.300">
          <InputLeftElement paddingY={1.5} height="auto" pointerEvents="none">
            <Search color={gray400} width={16} />
          </InputLeftElement>
          <Input
            name="query"
            type="search"
            placeholder="Search"
            _placeholder={{ color: "gray.800" }}
            fontSize={14}
            paddingY={1.5}
            height="auto"
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
        <FilterToggle />
      </HStack>
      {evaluatorType === "google_cloud/dlp_pii_detection" && (
        <Alert status="info">
          <AlertIcon />
          <Text>
            Heads up! Since LangWatch already redacts PII, all message samples
            should pass here on the {'"'}Try it out{'"'}. You can still try it
            out to see the results if you want though.
          </Text>
        </Alert>
      )}
      <HStack width="full" align="start" spacing={6} paddingBottom={6}>
        <Card width="full" minHeight="400px">
          <CardHeader>
            <HStack spacing={4}>
              <Text fontWeight="500">
                {tracesPassingPreconditionsOnLoad.isLoading
                  ? "Fetching samples..."
                  : `Fetched ${
                      (tracesPassingPreconditionsOnLoad.data ?? []).length
                    } random sample messages${
                      preconditions.length > 0 && allPassing
                        ? " passing preconditions"
                        : ""
                    }`}
              </Text>
              <Spacer />
              <Button
                onClick={() => {
                  console.log("preconditions", preconditions);
                  setFetchingPreconditions(preconditions);
                  setRandomSeed(Math.random() * 1000);
                }}
                leftIcon={
                  <RefreshCw
                    size={16}
                    className={
                      tracesPassingPreconditionsOnLoad.isLoading
                        ? "refresh-icon animation-spinning"
                        : "refresh-icon"
                    }
                  />
                }
                isDisabled={tracesPassingPreconditionsOnLoad.isLoading}
                size="sm"
              >
                Shuffle
              </Button>
              <Button
                leftIcon={
                  runningState.state === "running" ? (
                    <Spinner size="sm" />
                  ) : runningState.state === "paused" ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )
                }
                colorScheme="orange"
                size="sm"
                isDisabled={firstPassingPrecondition === -1}
                onClick={() => {
                  if (runningState.state === "idle") {
                    const firstTraceId =
                      tracesPassingPreconditionsOnLoad.data?.[
                        firstPassingPrecondition
                      ]?.trace_id;

                    if (!firstTraceId) {
                      return;
                    }

                    setRunningResults({});
                    setRunningState({
                      state: "running",
                      nextTraceId: firstTraceId,
                    });
                  } else if (runningState.state === "paused") {
                    setRunningState({
                      state: "running",
                      nextTraceId: runningState.nextTraceId,
                    });
                  } else {
                    setRunningState({ state: "paused", nextTraceId: "" });
                  }
                }}
              >
                {runningState.state === "running"
                  ? "Running..."
                  : runningState.state === "paused"
                  ? "Paused"
                  : "Run on samples"}
              </Button>
            </HStack>
          </CardHeader>
          <CardBody paddingX={2} paddingTop={0}>
            <VStack width="full" align="start" spacing={6}>
              <TableContainer>
                <Table variant="simple">
                  <Thead>
                    <Tr>
                      <Th width="150px">Timestamp</Th>
                      <Th width="250px">Input</Th>
                      <Th width="250px">Output</Th>
                      {evaluatorDefinition?.isGuardrail ? (
                        <Th>Passed</Th>
                      ) : (
                        <Th>Score</Th>
                      )}
                      <Th width="350px">Details</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {tracesPassingPreconditionsOnLoad.data?.map((trace, i) => {
                      const livePassesPreconditions =
                        tracesLivePassesPreconditions[i];
                      const runningResult = runningResults[trace.trace_id];
                      const color =
                        runningResult && runningResult.status !== "loading"
                          ? checkStatusColorMap(runningResult)
                          : undefined;
                      const resultDetails = runningResult
                        ? "details" in runningResult
                          ? runningResult.details
                          : "message" in runningResult
                          ? runningResult.message
                          : ""
                        : "";

                      return (
                        <Tooltip
                          key={trace.trace_id}
                          hasArrow
                          placement="top"
                          label={
                            livePassesPreconditions
                              ? undefined
                              : "Entry does not match the pre-conditions"
                          }
                        >
                          <Tr
                            role="button"
                            cursor="pointer"
                            background={
                              livePassesPreconditions ? undefined : "gray.100"
                            }
                            color={
                              livePassesPreconditions ? undefined : "gray.400"
                            }
                          >
                            <Td
                              maxWidth="150px"
                              onClick={() =>
                                openDrawer("traceDetails", {
                                  traceId: trace.trace_id,
                                })
                              }
                            >
                              {new Date(
                                trace.timestamps.started_at
                              ).toLocaleDateString(undefined, {
                                month: "numeric",
                                day: "numeric",
                              }) +
                                ", " +
                                new Date(
                                  trace.timestamps.started_at
                                ).toLocaleTimeString(undefined, {
                                  hour: "numeric",
                                  minute: "numeric",
                                })}
                            </Td>
                            <Td
                              maxWidth="250px"
                              onClick={() =>
                                openDrawer("traceDetails", {
                                  traceId: trace.trace_id,
                                })
                              }
                            >
                              <Tooltip
                                label={
                                  livePassesPreconditions
                                    ? trace.input.value
                                    : undefined
                                }
                              >
                                <Text
                                  noOfLines={1}
                                  wordBreak="break-all"
                                  display="block"
                                >
                                  {trace.input.value
                                    ? trace.input.value
                                    : "<empty>"}
                                </Text>
                              </Tooltip>
                            </Td>
                            {trace.error ? (
                              <Td
                                onClick={() =>
                                  openDrawer("traceDetails", {
                                    traceId: trace.trace_id,
                                  })
                                }
                              >
                                <Text
                                  noOfLines={1}
                                  maxWidth="250px"
                                  display="block"
                                  color="red.400"
                                >
                                  Error
                                  {trace.error.message ? ": " : ""}
                                  {trace.error.message}
                                </Text>
                              </Td>
                            ) : (
                              <Td
                                onClick={() =>
                                  openDrawer("traceDetails", {
                                    traceId: trace.trace_id,
                                  })
                                }
                              >
                                <Tooltip
                                  label={
                                    livePassesPreconditions
                                      ? trace.output?.value
                                      : undefined
                                  }
                                >
                                  <Text
                                    noOfLines={1}
                                    display="block"
                                    maxWidth="250px"
                                  >
                                    {(trace.output?.value ?? "").trim() !== ""
                                      ? trace.output?.value
                                      : "<empty>"}
                                  </Text>
                                </Tooltip>
                              </Td>
                            )}
                            {runningResult ? (
                              runningResult.status === "loading" ? (
                                <Td>
                                  <Spinner size="sm" />
                                </Td>
                              ) : runningResult.status === "skipped" ? (
                                <Td color={color}>Skipped</Td>
                              ) : runningResult.status === "error" ? (
                                <Td color={color}>Error</Td>
                              ) : evaluatorDefinition?.isGuardrail ? (
                                <Td color={color}>
                                  {runningResult.passed ? "Pass" : "Fail"}
                                </Td>
                              ) : (
                                <Td color={color}>{runningResult.score}</Td>
                              )
                            ) : i == firstPassingPrecondition ? (
                              <Td>Waiting to run</Td>
                            ) : (
                              <Td></Td>
                            )}
                            <Td color={color} maxWidth="300px">
                              {runningResult &&
                                (resultDetails ? (
                                  <Tooltip label={resultDetails}>
                                    <Text
                                      noOfLines={2}
                                      wordBreak="break-all"
                                      display="block"
                                    >
                                      {resultDetails}
                                    </Text>
                                  </Tooltip>
                                ) : (
                                  "-"
                                ))}
                            </Td>
                          </Tr>
                        </Tooltip>
                      );
                    })}
                    {tracesPassingPreconditionsOnLoad.isLoading &&
                      Array.from({ length: 10 }).map((_, i) => (
                        <Tr key={i}>
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Td key={i}>
                              <Skeleton height="20px" />
                            </Td>
                          ))}
                        </Tr>
                      ))}
                    {tracesPassingPreconditionsOnLoad.isFetched &&
                      tracesPassingPreconditionsOnLoad.data?.length === 0 && (
                        <Tr>
                          <Td colSpan={5}>
                            No messages found, try selecting different filters
                            and dates
                          </Td>
                        </Tr>
                      )}
                  </Tbody>
                </Table>
              </TableContainer>
            </VStack>
          </CardBody>
        </Card>
        <FilterSidebar />
      </HStack>
    </VStack>
  );
}
