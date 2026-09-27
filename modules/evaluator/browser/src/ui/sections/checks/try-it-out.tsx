import {
  Alert,
  Button,
  Card,
  Heading,
  HStack,
  Input,
  Skeleton,
  Spacer,
  Spinner,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  PeriodSelector,
  usePeriodSelector,
  useFilterParams,
  FilterToggle,
} from "@langwatch/analytics-browser-kit";
import { FilterSidebar } from "@langwatch/analytics-browser/surfaces/filter-sidebar";
import { toaster } from "@langwatch/browser-host/toaster";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { useColorRawValue } from "@langwatch/design-system/color-mode";
import { formatMoney } from "@langwatch/design-system/format-money";
import { InputGroup } from "@langwatch/design-system/input-group";
import { Tooltip } from "@langwatch/design-system/tooltip";
import type { Money } from "@langwatch/design-system/type-utils";
import { evaluationStatusColor } from "@langwatch/evaluator-browser-kit";
import {
  evaluatorSettingsSchemaFor,
  type SingleEvaluationResult,
  getEvaluatorDefinitions,
} from "@langwatch/evaluator-contract";
import type { ElasticSearchTrace } from "@langwatch/trace-contract";
import numeral from "numeral";
import { useEffect, useState } from "react";
import { Pause, Play, RefreshCw, Search } from "react-feather";
import type { UseFormReturn } from "react-hook-form";
import { useDebounceValue } from "usehooks-ts";

import { HoverableBigText, RedactedField } from "../../../behavior/lent-workflow.tsx";
import { readableDate } from "../../../model/display-formatters.ts";
import {
  buildPreconditionTraceDataFromTrace,
  checkEvaluatorRequiredFields,
  evaluatePreconditions,
} from "../../../model/evaluations/preconditions.ts";
import type { CheckPreconditions } from "../../../model/evaluations/types.ts";
import type { CheckConfigFormData } from "./check-config-form.tsx";

type RunRequestState = "idle" | "paused" | "running";

function runRequestIcon(state: RunRequestState) {
  if (state === "running") return <Spinner size="sm" />;
  if (state === "paused") return <Pause size={16} />;
  return <Play size={16} />;
}

function runRequestLabel(state: RunRequestState): string {
  if (state === "running") return "Running...";
  if (state === "paused") return "Paused";
  return "Run on samples";
}

/** The one column a built-in evaluator earns: "Passed" for a guardrail,
 *  "Score" when it scores, neither when it does both via `custom/`. */
function scoreOrPassedHeader(
  evaluatorDefinition: { isGuardrail: boolean; result: { score?: unknown } } | undefined,
) {
  if (evaluatorDefinition?.isGuardrail) {
    return <Table.ColumnHeader width="120px">Passed</Table.ColumnHeader>;
  }
  if (evaluatorDefinition?.result.score) {
    return <Table.ColumnHeader width="120px">Score</Table.ColumnHeader>;
  }
  return null;
}

/** Placeholder for a row with no result yet: the next one up names itself,
 *  the rest stay blank. */
function waitingCell(isNextUp: boolean) {
  if (isNextUp) return <Table.Cell maxWidth="120">Waiting to run</Table.Cell>;
  return <Table.Cell maxWidth="120"></Table.Cell>;
}

export function TryItOut({
  form,
}: {
  form: UseFormReturn<CheckConfigFormData, unknown, CheckConfigFormData>;
}) {
  const { project } = useOrganizationTeamProject();
  const { watch } = form;
  const gray400 = useColorRawValue("gray.400");

  const evaluatorType = watch("checkType");
  const preconditions = watch("preconditions");
  const settings = watch("settings");
  const mappings = watch("mappings");

  const evaluatorDefinition = evaluatorType ? getEvaluatorDefinitions(evaluatorType) : undefined;

  const [query, setQuery] = useDebounceValue("", 300);
  const {
    period: { startDate, endDate },
    mode,
    setPeriod,
    setRelativePeriod,
  } = usePeriodSelector();
  const { filterParams } = useFilterParams();
  const { openDrawer } = useDrawer();
  const [randomSeed, setRandomSeed] = useState<number>(Math.random() * 1000);
  const [fetchingParams, setFetchingParams] = useState<
    { preconditions: CheckPreconditions; evaluatorType: string } | undefined
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
    },
  );

  useEffect(() => {
    setFetchingParams({ preconditions, evaluatorType: evaluatorType! });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allPassing = allPassPreconditions(tracesPassingPreconditionsOnLoad.data);
  const tracesLivePassesPreconditions = livePassesFor({
    traces: tracesPassingPreconditionsOnLoad.data,
    evaluatorType,
    preconditions,
  });
  const firstPassingPrecondition = tracesLivePassesPreconditions.findIndex((pass) => pass);

  const [runningResults, setRunningResults] = useState<
    Record<string, { status: "loading" } | SingleEvaluationResult>
  >({});
  const [runningState, setRunningState] = useState<RunningState>({ state: "idle" });

  const runEvaluation = api.evaluations.runEvaluation.useMutation();

  useEffect(() => {
    setRunningResults({});
    setRunningState({ state: "idle" });
  }, [tracesPassingPreconditionsOnLoad.data]);

  const runningNextTraceId = runningState.state === "idle" ? undefined : runningState.nextTraceId;

  useEffect(() => {
    if (!project || !evaluatorType || runningState.state !== "running") return;

    setRunningResults((prev) => ({
      ...prev,
      [runningState.nextTraceId]: { status: "loading" },
    }));

    const moveToNext = () => {
      const nextTraceId = nextRunnableTraceId({
        passes: tracesLivePassesPreconditions,
        traces: tracesPassingPreconditionsOnLoad.data,
        processed: [...Object.keys(runningResults), runningState.nextTraceId],
      });

      setRunningState((current) => advanceRunningState(current, nextTraceId));
    };

    const parsedSettings = parseRunSettings({ evaluatorType, settings, evaluatorDefinition });
    if (!parsedSettings.ok) return;
    const settings_ = parsedSettings.settings;

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
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningState.state, runningNextTraceId]);

  const totalCost = Object.values(runningResults).reduce(
    (acc, result) =>
      acc + (result.status === "processed" ? ((result.cost as Money)?.amount ?? 0) : 0),
    0,
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
          borderColor="border.emphasized"
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
        <PeriodSelector
          period={{ startDate, endDate }}
          mode={mode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
        />
        <FilterToggle />
      </HStack>
      {evaluatorType === "presidio/pii_detection" && (
        <Alert.Root>
          <Alert.Indicator />
          <Alert.Content>
            <Text>
              Heads up! Since LangWatch already redacts PII, you won{"'"}t see any bad examples
              here. You can still try it though.
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
                      preconditions.length > 0 && allPassing ? " passing preconditions" : ""
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
                  const next = toggledRunningState(
                    runningState,
                    tracesPassingPreconditionsOnLoad.data?.[firstPassingPrecondition]?.trace_id,
                  );
                  if (!next) return;
                  if (runningState.state === "idle") setRunningResults({});
                  setRunningState(next);
                }}
              >
                {runRequestIcon(runningState.state)}
                {runRequestLabel(runningState.state)}
              </Button>
            </HStack>
          </Card.Header>
          <Card.Body paddingX={2} paddingTop={0}>
            <VStack width="full" align="start" gap={6}>
              <Table.Root variant="line">
                <SampleTableHeader
                  evaluatorType={evaluatorType}
                  evaluatorDefinition={evaluatorDefinition}
                  hasAnyLabels={!!hasAnyLabels}
                />
                <Table.Body>
                  {tracesPassingPreconditionsOnLoad.data?.map(
                    (trace: SampleTraceRow, i: number) => {
                      const livePassesPreconditions = tracesLivePassesPreconditions[i];
                      const runningResult = runningResults[trace.trace_id];
                      const color = resultColor(runningResult);
                      const resultCells = resultCellsFor({
                        runningResult,
                        color,
                        evaluatorType,
                        evaluatorDefinition,
                        hasAnyLabels: !!hasAnyLabels,
                      });

                      return (
                        <SampleRow
                          key={trace.trace_id}
                          trace={trace}
                          livePassesPreconditions={!!livePassesPreconditions}
                          color={color}
                          resultCells={runningResult ? resultCells : undefined}
                          waitingCell={waitingCell(i === firstPassingPrecondition)}
                          onOpenTrace={() =>
                            openDrawer("traceV2Details", { traceId: trace.trace_id })
                          }
                        />
                      );
                    },
                  )}

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
                          No messages found, try selecting different filters and dates
                        </Table.Cell>
                      </Table.Row>
                    )}
                  <Table.Row>
                    <Table.Cell colSpan={5} textAlign="right" fontWeight={500}>
                      Total Cost:
                    </Table.Cell>
                    <Table.Cell>{totalCostText(runningResults, totalCost)}</Table.Cell>
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

type RunningResult = { status: "loading" } | SingleEvaluationResult;

function resultCellsFor({
  runningResult,
  color,
  evaluatorType,
  evaluatorDefinition,
  hasAnyLabels,
}: {
  runningResult: RunningResult | undefined;
  color: string | undefined;
  evaluatorType: string | undefined;
  evaluatorDefinition: ReturnType<typeof getEvaluatorDefinitions>;
  hasAnyLabels: boolean;
}) {
  if (!runningResult) return { scoreCells: null, details: null, cost: null };
  const isCustom = !!evaluatorType?.startsWith("custom/");
  const showsLabel =
    hasAnyLabels &&
    (evaluatorDefinition?.isGuardrail ||
      !!evaluatorDefinition?.result.score ||
      runningResult.status === "processed");
  const customScore = isCustom ? (
    <Table.Cell maxWidth="120" color={color}>
      {"score" in runningResult ? numeral(runningResult.score).format("0.[00]") : "-"}
    </Table.Cell>
  ) : null;
  return {
    scoreCells: (
      <>
        {scoreCellFor({ runningResult, color, isCustom, evaluatorDefinition })}
        {customScore}
        {showsLabel && (
          <Table.Cell maxWidth="120" color={color}>
            {"label" in runningResult ? runningResult.label : "-"}
          </Table.Cell>
        )}
        {customScore}
      </>
    ),
    details: detailsCellFor(runningResult),
    cost: costCellFor(runningResult),
  };
}

function detailsCellFor(runningResult: RunningResult): React.ReactNode {
  const details = "details" in runningResult ? runningResult.details : "";
  if (details) return <HoverableBigText lineClamp={3}>{details}</HoverableBigText>;
  return runningResult.status === "loading" ? "" : "-";
}

function costCellFor(runningResult: RunningResult): React.ReactNode {
  if (runningResult.status === "processed") {
    return formatMoney((runningResult.cost as Money) ?? { amount: 0, currency: "USD" });
  }
  return runningResult.status === "loading" ? "" : "-";
}

function scoreCellFor({
  runningResult,
  color,
  isCustom,
  evaluatorDefinition,
}: {
  runningResult: RunningResult;
  color: string | undefined;
  isCustom: boolean;
  evaluatorDefinition: ReturnType<typeof getEvaluatorDefinitions>;
}): React.ReactNode {
  if (runningResult.status === "loading") {
    return (
      <Table.Cell maxWidth="120">
        <Spinner size="sm" />
      </Table.Cell>
    );
  }
  const text = scoreTextFor({ runningResult, isCustom, evaluatorDefinition });
  if (text === undefined) return null;
  return (
    <Table.Cell maxWidth="120" color={color}>
      {text}
    </Table.Cell>
  );
}

function scoreTextFor({
  runningResult,
  isCustom,
  evaluatorDefinition,
}: {
  runningResult: SingleEvaluationResult;
  isCustom: boolean;
  evaluatorDefinition: ReturnType<typeof getEvaluatorDefinitions>;
}): string | undefined {
  if (runningResult.status === "skipped") return "Skipped";
  if (runningResult.status === "error") return "Error";
  if (isCustom) {
    if (!("passed" in runningResult)) return "-";
    return runningResult.passed ? "Pass" : "Fail";
  }
  if (evaluatorDefinition?.isGuardrail) return runningResult.passed ? "Pass" : "Fail";
  if (evaluatorDefinition?.result.score) return numeral(runningResult.score).format("0.[00]");
  return undefined;
}

function nextRunnableTraceId({
  passes,
  traces,
  processed,
}: {
  passes: boolean[];
  traces: readonly { trace_id?: string }[] | undefined;
  processed: string[];
}): string | undefined {
  const nextIndex = passes.findIndex(
    (pass, index) => pass && !processed.includes(traces?.[index]?.trace_id ?? ""),
  );
  return traces?.[nextIndex]?.trace_id;
}

/** Settings that fail their schema stop the run, unless the evaluator takes none at all. */
function parseRunSettings({
  evaluatorType,
  settings,
  evaluatorDefinition,
}: {
  evaluatorType: string;
  settings: Record<string, unknown>;
  evaluatorDefinition: ReturnType<typeof getEvaluatorDefinitions>;
}): { ok: true; settings: Record<string, unknown> } | { ok: false } {
  const settingsLookup = evaluatorSettingsSchemaFor(evaluatorType);
  try {
    if (!settingsLookup.found) throw new Error(`no settings schema for ${evaluatorType}`);
    return { ok: true, settings: settingsLookup.schema.parse(settings) };
  } catch (e) {
    if (Object.keys(evaluatorDefinition?.settings ?? {}).length === 0) {
      return { ok: true, settings: {} };
    }
    toaster.create({
      title: "Invalid evaluator settings",
      description: "Please check your settings and try again.",
      type: "error",
    });
    console.error(e);
    return { ok: false };
  }
}

type SampleTraceInput = Parameters<typeof buildPreconditionTraceDataFromTrace>[0]["trace"] & {
  spans?: Parameters<typeof buildPreconditionTraceDataFromTrace>[0]["spans"];
};

function allPassPreconditions(
  traces: readonly { passesPreconditions?: boolean }[] | undefined,
): boolean {
  return traces?.every((trace) => trace.passesPreconditions) ?? false;
}

/** Whether each sample still passes, against the preconditions as edited now. */
function livePassesFor({
  traces,
  evaluatorType,
  preconditions,
}: {
  traces: readonly SampleTraceInput[] | undefined;
  evaluatorType: string | undefined;
  preconditions: CheckPreconditions;
}): boolean[] {
  return (traces ?? []).map((trace) => {
    if (!evaluatorType) return false;
    const spans = trace.spans ?? [];
    const requiredFieldsMet = checkEvaluatorRequiredFields({
      evaluatorType,
      spans,
      expectedOutput: trace.expected_output,
    });
    if (!requiredFieldsMet) return false;
    const traceData = buildPreconditionTraceDataFromTrace({ trace, spans });
    return evaluatePreconditions({ traceData, preconditions });
  });
}

function totalCostText(
  runningResults: Record<string, RunningResult>,
  totalCost: number,
): React.ReactNode {
  const results = Object.values(runningResults);
  if (results.filter((result) => result.status !== "loading").length === 0) return "-";
  const costed = results.find(
    (result): result is Extract<SingleEvaluationResult, { status: "processed" }> =>
      result.status === "processed" && !!result.cost,
  );
  const currency = costed?.cost?.currency === "EUR" ? "EUR" : "USD";
  return formatMoney({ amount: totalCost, currency });
}

type SampleTraceRow = Pick<
  ElasticSearchTrace,
  "trace_id" | "timestamps" | "input" | "output" | "error"
>;

function SampleRow({
  trace,
  livePassesPreconditions,
  color,
  resultCells,
  waitingCell,
  onOpenTrace,
}: {
  trace: SampleTraceRow;
  livePassesPreconditions: boolean;
  color: string | undefined;
  resultCells: ReturnType<typeof resultCellsFor> | undefined;
  waitingCell: React.ReactNode;
  onOpenTrace: () => void;
}) {
  return (
    <Tooltip
      showArrow
      positioning={{ placement: "top" }}
      content={livePassesPreconditions ? undefined : "Entry does not match the pre-conditions"}
    >
      <Table.Row
        cursor="pointer"
        background={livePassesPreconditions ? undefined : "gray.100"}
        color={livePassesPreconditions ? undefined : "gray.400"}
      >
        <Table.Cell maxWidth="180px" onClick={onOpenTrace}>
          {readableDate(trace.timestamps.started_at).toLocaleDateString(undefined, {
            month: "numeric",
            day: "numeric",
          }) +
            ", " +
            readableDate(trace.timestamps.started_at).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "numeric",
            })}
        </Table.Cell>
        <Table.Cell maxWidth="225px" onClick={onOpenTrace}>
          <Tooltip content={livePassesPreconditions ? (trace.input?.value ?? "") : undefined}>
            <RedactedField field="input">
              <Text lineClamp={1} wordBreak="break-all" display="block">
                {trace.input?.value ?? "<empty>"}
              </Text>
            </RedactedField>
          </Tooltip>
        </Table.Cell>
        {trace.error ? (
          <Table.Cell maxWidth="225px" onClick={onOpenTrace}>
            <Text lineClamp={1} maxWidth="250px" display="block" color="red.400">
              Error
              {trace.error.message ? ": " : ""}
              {trace.error.message}
            </Text>
          </Table.Cell>
        ) : (
          <Table.Cell maxWidth="225px" onClick={onOpenTrace}>
            <Tooltip content={livePassesPreconditions ? trace.output?.value : undefined}>
              <RedactedField field="output">
                <Text lineClamp={1} display="block" maxWidth="250px">
                  {(trace.output?.value ?? "").trim() !== "" ? trace.output?.value : "<empty>"}
                </Text>
              </RedactedField>
            </Tooltip>
          </Table.Cell>
        )}
        {resultCells ? resultCells.scoreCells : waitingCell}
        <Table.Cell color={color} maxWidth="250px">
          {resultCells?.details}
        </Table.Cell>
        <Table.Cell maxWidth="120px">{resultCells?.cost}</Table.Cell>
      </Table.Row>
    </Tooltip>
  );
}

function resultColor(runningResult: RunningResult | undefined) {
  if (!runningResult || runningResult.status === "loading") return undefined;
  return evaluationStatusColor(runningResult);
}

function SampleTableHeader({
  evaluatorType,
  evaluatorDefinition,
  hasAnyLabels,
}: {
  evaluatorType: string | undefined;
  evaluatorDefinition: ReturnType<typeof getEvaluatorDefinitions>;
  hasAnyLabels: boolean;
}) {
  const isCustom = !!evaluatorType?.startsWith("custom/");
  return (
    <Table.Header>
      <Table.Row>
        <Table.ColumnHeader width="180px">Timestamp</Table.ColumnHeader>
        <Table.ColumnHeader width="225px">Input</Table.ColumnHeader>
        <Table.ColumnHeader width="225px">Output</Table.ColumnHeader>
        {scoreOrPassedHeader(evaluatorDefinition)}
        {isCustom && <Table.ColumnHeader width="120px">Passed</Table.ColumnHeader>}
        {isCustom && <Table.ColumnHeader width="120px">Score</Table.ColumnHeader>}
        {hasAnyLabels && <Table.ColumnHeader width="120px">Label</Table.ColumnHeader>}
        <Table.ColumnHeader width="250px">Details</Table.ColumnHeader>
        <Table.ColumnHeader width="120px">Cost</Table.ColumnHeader>
      </Table.Row>
    </Table.Header>
  );
}

type RunningState = { state: "idle" } | { state: "paused" | "running"; nextTraceId: string };

/** Moves the run to the next runnable sample, or back to idle when none is left. */
function advanceRunningState(current: RunningState, nextTraceId: string | undefined): RunningState {
  if (!nextTraceId) return { state: "idle" };
  return current.state === "idle" ? current : { ...current, nextTraceId };
}

/** Run from the first passing sample, resume where paused, or pause; nothing to run: no change. */
function toggledRunningState(
  current: RunningState,
  firstTraceId: string | undefined,
): RunningState | undefined {
  if (current.state === "idle") {
    return firstTraceId ? { state: "running", nextTraceId: firstTraceId } : undefined;
  }
  if (current.state === "paused") return { state: "running", nextTraceId: current.nextTraceId };
  return { state: "paused", nextTraceId: "" };
}
