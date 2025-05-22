import {
  Alert,
  Button,
  Card,
  HStack,
  Heading,
  Input,
  Skeleton,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { useEffect, useState } from "react";
import { Pause, Play, RefreshCw, Search } from "react-feather";
import { type UseFormReturn } from "react-hook-form";
import { useDebounceValue } from "usehooks-ts";
import { useColorRawValue } from "../../components/ui/color-mode";
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
import { type ElasticSearchSpan } from "../../server/tracer/types";
import { transformElasticSearchSpanToSpan } from "../../server/elasticsearch/transformers";
import { api } from "../../utils/api";
import { formatMoney } from "../../utils/formatMoney";
import type { Money } from "../../utils/types";
import { useDrawer } from "../CurrentDrawer";
import { HoverableBigText } from "../HoverableBigText";
import { PeriodSelector, usePeriodSelector } from "../PeriodSelector";
import { FilterSidebar } from "../filters/FilterSidebar";
import { FilterToggle } from "../filters/FilterToggle";
import { Tooltip } from "../ui/tooltip";
import type { CheckConfigFormData } from "./CheckConfigForm";
import { evaluationStatusColor } from "./EvaluationStatus";
import { toaster } from "../../components/ui/toaster";
import { InputGroup } from "../ui/input-group";
import { RedactedField } from "../ui/RedactedField";
import { getUserProtectionsForProject } from "~/server/api/utils";

export function TryItOut({
  form,
}: {
  form: UseFormReturn<CheckConfigFormData, any, undefined>;
}) {
  const { project } = useOrganizationTeamProject();
  const { watch } = form;
  const gray400 = useColorRawValue("gray.400");

  const evaluatorType = watch("checkType");
  const preconditions = watch("preconditions");
  const settings = watch("settings");
  const mappings = watch("mappings");

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
          (trace.spans ?? []).map((span) =>
            transformElasticSearchSpanToSpan(
              span as ElasticSearchSpan,
              {
                canSeeCapturedInput: true,
                canSeeCapturedOutput: true,
                canSeeCosts: true,
              },
              new Set()
            )
          ),
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

    let settings_;
    try {
      settings_ =
        evaluatorsSchema.shape[evaluatorType].shape.settings.parse(settings);
    } catch (e) {
      if (Object.keys(evaluatorDefinition?.settings ?? {}).length === 0) {
        settings_ = {};
      } else {
        toaster.create({
          title: "Invalid evaluator settings",
          description: "Please check your settings and try again.",
          type: "error",
          meta: {
            closable: true,
          },
          placement: "top-end",
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
        mappings: mappings,
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
              details: err.message,
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

  const hasAnyLabels = evaluatorDefinition?.result.label;

  return (
    <VStack width="full" gap={6} marginTop={6}>
      <HStack width="full" align="end">
        <Heading as="h2" size="lg" textAlign="center" paddingTop={4}>
          Try it out
        </Heading>
        <Spacer />
        <InputGroup
          maxWidth="350px"
          borderColor="gray.300"
          startElement={<Search color={gray400} width={16} />}
        >
          <Input
            name="query"
            type="search"
            placeholder="Search"
            _placeholder={{ color: "gray.800" }}
            fontSize="14px"
            paddingY={1.5}
            height="auto"
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <PeriodSelector period={{ startDate, endDate }} setPeriod={setPeriod} />
        <FilterToggle />
      </HStack>
      {evaluatorType === "presidio/pii_detection" && (
        <Alert.Root>
          <Alert.Indicator />
          <Alert.Content>
            <Text>
              Heads up! Since LangWatch already redacts PII, you won{"'"}t see
              any bad examples here. You can still try it though.
            </Text>
          </Alert.Content>
        </Alert.Root>
      )}
      <HStack width="full" align="start" gap={6} paddingBottom={6}>
        <Card.Root width="full" minHeight="400px">
          <Card.Header>
            <HStack gap={4}>
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
                size="sm"
              >
                <RefreshCw
                  size={16}
                  className={
                    tracesPassingPreconditionsOnLoad.isLoading
                      ? "refresh-icon animation-spinning"
                      : "refresh-icon"
                  }
                />
                Shuffle
              </Button>
              <Button
                colorPalette="orange"
                size="sm"
                disabled={firstPassingPrecondition === -1}
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
                {runningState.state === "running" ? (
                  <Spinner size="sm" />
                ) : runningState.state === "paused" ? (
                  <Pause size={16} />
                ) : (
                  <Play size={16} />
                )}
                {runningState.state === "running"
                  ? "Running..."
                  : runningState.state === "paused"
                  ? "Paused"
                  : "Run on samples"}
              </Button>
            </HStack>
          </Card.Header>
          <Card.Body paddingX={2} paddingTop={0}>
            <VStack width="full" align="start" gap={6}>
              <Table.Root variant="line">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader width="180px">
                      Timestamp
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="225px">Input</Table.ColumnHeader>
                    <Table.ColumnHeader width="225px">
                      Output
                    </Table.ColumnHeader>
                    {evaluatorDefinition?.isGuardrail ? (
                      <Table.ColumnHeader width="120px">
                        Passed
                      </Table.ColumnHeader>
                    ) : evaluatorDefinition?.result.score ? (
                      <Table.ColumnHeader width="120px">
                        Score
                      </Table.ColumnHeader>
                    ) : null}
                    {evaluatorType?.startsWith("custom/") ? (
                      <Table.ColumnHeader width="120px">
                        Passed
                      </Table.ColumnHeader>
                    ) : null}
                    {evaluatorType?.startsWith("custom/") ? (
                      <Table.ColumnHeader width="120px">
                        Score
                      </Table.ColumnHeader>
                    ) : null}
                    {hasAnyLabels && (
                      <Table.ColumnHeader width="120px">
                        Label
                      </Table.ColumnHeader>
                    )}
                    <Table.ColumnHeader width="250px">
                      Details
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width="120px">Cost</Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
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
                        : ""
                      : "";

                    return (
                      <Tooltip
                        key={trace.trace_id}
                        showArrow
                        positioning={{ placement: "top" }}
                        content={
                          livePassesPreconditions
                            ? undefined
                            : "Entry does not match the pre-conditions"
                        }
                      >
                        <Table.Row
                          role="button"
                          cursor="pointer"
                          background={
                            livePassesPreconditions ? undefined : "gray.100"
                          }
                          color={
                            livePassesPreconditions ? undefined : "gray.400"
                          }
                        >
                          <Table.Cell
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
                          </Table.Cell>
                          <Table.Cell
                            maxWidth="225px"
                            onClick={() =>
                              openDrawer("traceDetails", {
                                traceId: trace.trace_id,
                              })
                            }
                          >
                            <Tooltip
                              content={
                                livePassesPreconditions
                                  ? trace.input?.value ?? ""
                                  : undefined
                              }
                            >
                              <RedactedField field="input">
                                <Text
                                  lineClamp={1}
                                  wordBreak="break-all"
                                  display="block"
                                >
                                  {trace.input?.value ?? "<empty>"}
                                </Text>
                              </RedactedField>
                            </Tooltip>
                          </Table.Cell>
                          {trace.error ? (
                            <Table.Cell
                              maxWidth="225px"
                              onClick={() =>
                                openDrawer("traceDetails", {
                                  traceId: trace.trace_id,
                                })
                              }
                            >
                              <Text
                                lineClamp={1}
                                maxWidth="250px"
                                display="block"
                                color="red.400"
                              >
                                Error
                                {trace.error.message ? ": " : ""}
                                {trace.error.message}
                              </Text>
                            </Table.Cell>
                          ) : (
                            <Table.Cell
                              maxWidth="225px"
                              onClick={() =>
                                openDrawer("traceDetails", {
                                  traceId: trace.trace_id,
                                })
                              }
                            >
                              <Tooltip
                                content={
                                  livePassesPreconditions
                                    ? trace.output?.value
                                    : undefined
                                }
                              >
                                <RedactedField field="output">
                                  <Text
                                    lineClamp={1}
                                    display="block"
                                    maxWidth="250px"
                                  >
                                    {(trace.output?.value ?? "").trim() !== ""
                                      ? trace.output?.value
                                      : "<empty>"}
                                  </Text>
                                </RedactedField>
                              </Tooltip>
                            </Table.Cell>
                          )}
                          {runningResult ? (
                            <>
                              {runningResult.status === "loading" ? (
                                <Table.Cell maxWidth="120">
                                  <Spinner size="sm" />
                                </Table.Cell>
                              ) : runningResult.status === "skipped" ? (
                                <Table.Cell maxWidth="120" color={color}>
                                  Skipped
                                </Table.Cell>
                              ) : runningResult.status === "error" ? (
                                <Table.Cell maxWidth="120" color={color}>
                                  Error
                                </Table.Cell>
                              ) : evaluatorType?.startsWith("custom/") ? (
                                <Table.Cell maxWidth="120" color={color}>
                                  {"passed" in runningResult
                                    ? runningResult.passed
                                      ? "Pass"
                                      : "Fail"
                                    : "-"}
                                </Table.Cell>
                              ) : evaluatorDefinition?.isGuardrail ? (
                                <Table.Cell maxWidth="120" color={color}>
                                  {runningResult.passed ? "Pass" : "Fail"}
                                </Table.Cell>
                              ) : evaluatorDefinition?.result.score ? (
                                <Table.Cell maxWidth="120" color={color}>
                                  {numeral(runningResult.score).format(
                                    "0.[00]"
                                  )}
                                </Table.Cell>
                              ) : null}

                              {evaluatorType?.startsWith("custom/") ? (
                                <Table.Cell maxWidth="120" color={color}>
                                  {"score" in runningResult
                                    ? numeral(runningResult.score).format(
                                        "0.[00]"
                                      )
                                    : "-"}
                                </Table.Cell>
                              ) : null}

                              {hasAnyLabels &&
                                (evaluatorDefinition?.isGuardrail ||
                                  !!evaluatorDefinition?.result.score ||
                                  runningResult.status === "processed") && (
                                  <Table.Cell maxWidth="120" color={color}>
                                    {"label" in runningResult
                                      ? runningResult.label
                                      : "-"}
                                  </Table.Cell>
                                )}
                              {evaluatorType?.startsWith("custom/") ? (
                                <Table.Cell maxWidth="120" color={color}>
                                  {"score" in runningResult
                                    ? numeral(runningResult.score).format(
                                        "0.[00]"
                                      )
                                    : "-"}
                                </Table.Cell>
                              ) : null}
                            </>
                          ) : i == firstPassingPrecondition ? (
                            <Table.Cell maxWidth="120">
                              Waiting to run
                            </Table.Cell>
                          ) : (
                            <Table.Cell maxWidth="120"></Table.Cell>
                          )}
                          <Table.Cell color={color} maxWidth="250px">
                            {runningResult &&
                              (resultDetails ? (
                                <HoverableBigText lineClamp={3}>
                                  {resultDetails}
                                </HoverableBigText>
                              ) : runningResult.status === "loading" ? (
                                ""
                              ) : (
                                "-"
                              ))}
                          </Table.Cell>
                          <Table.Cell maxWidth="120px">
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
                          </Table.Cell>
                        </Table.Row>
                      </Tooltip>
                    );
                  })}

                  {tracesPassingPreconditionsOnLoad.isLoading &&
                    Array.from({ length: 10 }).map((_, i) => (
                      <Table.Row key={i}>
                        {Array.from({ length: 6 }).map((_, i) => (
                          <Table.Cell key={i}>
                            <Skeleton height="20px" />
                          </Table.Cell>
                        ))}
                      </Table.Row>
                    ))}
                  {tracesPassingPreconditionsOnLoad.isFetched &&
                    tracesPassingPreconditionsOnLoad.data?.length === 0 && (
                      <Table.Row>
                        <Table.Cell colSpan={5}>
                          No messages found, try selecting different filters and
                          dates
                        </Table.Cell>
                      </Table.Row>
                    )}
                  <Table.Row>
                    <Table.Cell colSpan={5} textAlign="right" fontWeight={500}>
                      Total Cost:
                    </Table.Cell>
                    <Table.Cell>
                      {Object.values(runningResults).filter(
                        (result) => result.status !== "loading"
                      ).length > 0
                        ? formatMoney({
                            amount: totalCost,
                            currency:
                              (
                                Object.values(runningResults).filter(
                                  (result) =>
                                    result.status === "processed" && result.cost
                                )[0] as any
                              )?.cost.currency ?? "USD",
                          })
                        : "-"}
                    </Table.Cell>
                  </Table.Row>
                </Table.Body>
              </Table.Root>
            </VStack>
          </Card.Body>
        </Card.Root>
        <FilterSidebar />
      </HStack>
    </VStack>
  );
}
