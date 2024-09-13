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
  useToast,
} from "@chakra-ui/react";
import numeral from "numeral";
import { useEffect, useState } from "react";
import { Pause, Play, RefreshCw, Search } from "react-feather";
import { type UseFormReturn } from "react-hook-form";
import { useDebounceValue } from "usehooks-ts";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import {
  type Evaluators,
  type SingleEvaluationResult,
} from "../../server/evaluations/evaluators.generated";
import { evaluatorsSchema } from "../../server/evaluations/evaluators.zod.generated";
import { getEvaluatorDefinitions } from "../../server/evaluations/getEvaluator";
import { evaluatePreconditions } from "../../server/evaluations/preconditions";
import type { CheckPreconditions } from "../../server/evaluations/types";
import { api } from "../../utils/api";
import { formatMoney } from "../../utils/formatMoney";
import type { Money } from "../../utils/types";
import { useDrawer } from "../CurrentDrawer";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { FilterSidebar } from "../filters/FilterSidebar";
import { FilterToggle } from "../filters/FilterToggle";
import type { CheckConfigFormData } from "./CheckConfigForm";
import { evaluationStatusColor } from "./EvaluationStatus";
import { elasticSearchSpanToSpan } from "../../server/tracer/utils";

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
  const [fetchingParams, setFetchingParams] = useState<
    | { preconditions: CheckPreconditions; evaluatorType: keyof Evaluators }
    | undefined
  >(undefined);

  const tracesPassingPreconditionsOnLoad = api.traces.getSampleTraces.useQuery(
    {
      ...filterParams,
      ...fetchingParams!,
      query: query,
      expectedResults: 10,
      sortBy: `random.${randomSeed}`,
    },
    {
      enabled: !!filterParams.projectId && !!fetchingParams,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  );

  useEffect(() => {
    setFetchingParams({ preconditions, evaluatorType: evaluatorType! });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const toast = useToast();

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

    let settings_;
    try {
      settings_ =
        evaluatorsSchema.shape[evaluatorType].shape.settings.parse(settings);
    } catch (e) {
      if (Object.keys(evaluatorDefinition?.settings ?? {}).length === 0) {
        settings_ = {};
      } else {
        toast({
          title: "Invalid evaluator settings",
          description: "Please check your settings and try again.",
          status: "error",
          duration: 5000,
        });
        console.error(e);
        return;
      }
    }

    runEvaluation.mutate(
      {
        projectId: project.id,
        evaluatorType: evaluatorType,
        traceId: runningState.nextTraceId,
        settings: settings_,
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

  const totalCost = Object.values(runningResults).reduce(
    (acc, result) =>
      acc +
      (result.status === "processed" ? (result.cost as Money)?.amount ?? 0 : 0),
    0
  );

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
            Heads up! Since LangWatch already redacts PII, you won{"'"}t see any
            bad examples here. You can still try it though.
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
                  setFetchingParams({
                    preconditions,
                    evaluatorType: evaluatorType!,
                  });
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
                      <Th width="180px">Timestamp</Th>
                      <Th width="225px">Input</Th>
                      <Th width="225px">Output</Th>
                      {evaluatorDefinition?.isGuardrail ? (
                        <Th width="120px">Passed</Th>
                      ) : (
                        <Th width="120px">Score</Th>
                      )}
                      <Th width="250px">Details</Th>
                      <Th width="120px">Cost</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {tracesPassingPreconditionsOnLoad.data?.map((trace, i) => {
                      const livePassesPreconditions =
                        tracesLivePassesPreconditions[i];
                      const runningResult = runningResults[trace.trace_id];
                      const color =
                        runningResult && runningResult.status !== "loading"
                          ? evaluationStatusColor(runningResult)
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
                              maxWidth="180px"
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
                              maxWidth="225px"
                              onClick={() =>
                                openDrawer("traceDetails", {
                                  traceId: trace.trace_id,
                                })
                              }
                            >
                              <Tooltip
                                label={
                                  livePassesPreconditions
                                    ? trace.input?.value ?? ""
                                    : undefined
                                }
                              >
                                <Text
                                  noOfLines={1}
                                  wordBreak="break-all"
                                  display="block"
                                >
                                  {trace.input?.value ?? "<empty>"}
                                </Text>
                              </Tooltip>
                            </Td>
                            {trace.error ? (
                              <Td
                                maxWidth="225px"
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
                                maxWidth="225px"
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
                                <Td maxWidth="120">
                                  <Spinner size="sm" />
                                </Td>
                              ) : runningResult.status === "skipped" ? (
                                <Td maxWidth="120" color={color}>
                                  Skipped
                                </Td>
                              ) : runningResult.status === "error" ? (
                                <Td maxWidth="120" color={color}>
                                  Error
                                </Td>
                              ) : evaluatorDefinition?.isGuardrail ? (
                                <Td maxWidth="120" color={color}>
                                  {runningResult.passed ? "Pass" : "Fail"}
                                </Td>
                              ) : runningResult.label ? (
                                <Td maxWidth="120" color={color}>
                                  {runningResult.label}
                                </Td>
                              ) : (
                                <Td maxWidth="120" color={color}>
                                  {numeral(runningResult.score).format(
                                    "0.[00]"
                                  )}
                                </Td>
                              )
                            ) : i == firstPassingPrecondition ? (
                              <Td maxWidth="120">Waiting to run</Td>
                            ) : (
                              <Td maxWidth="120"></Td>
                            )}
                            <Td color={color} maxWidth="250px">
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
                                ) : runningResult.status === "loading" ? (
                                  ""
                                ) : (
                                  "-"
                                ))}
                            </Td>
                            <Td maxWidth="120px">
                              {runningResult &&
                                (runningResult.status === "processed"
                                  ? formatMoney(
                                      (runningResult.cost as Money) ?? {
                                        amount: 0,
                                        currency: "USD",
                                      }
                                    )
                                  : runningResult.status === "loading"
                                  ? ""
                                  : "-")}
                            </Td>
                          </Tr>
                        </Tooltip>
                      );
                    })}

                    {tracesPassingPreconditionsOnLoad.isLoading &&
                      Array.from({ length: 10 }).map((_, i) => (
                        <Tr key={i}>
                          {Array.from({ length: 6 }).map((_, i) => (
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
                    <Tr>
                      <Td colSpan={5} textAlign="right" fontWeight={500}>
                        Total Cost:
                      </Td>
                      <Td>
                        {Object.values(runningResults).filter(
                          (result) => result.status !== "loading"
                        ).length > 0
                          ? formatMoney({
                              amount: totalCost,
                              currency:
                                (
                                  Object.values(runningResults).filter(
                                    (result) =>
                                      result.status === "processed" &&
                                      result.cost
                                  )[0] as any
                                )?.cost.currency ?? "USD",
                            })
                          : "-"}
                      </Td>
                    </Tr>
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
