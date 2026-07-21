import {
  Badge,
  Box,
  Button,
  Code,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spacer,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { NotificationCadence } from "@langwatch/automations/cadences";
import { useEffect, useMemo, useState } from "react";
import { FieldsFilters } from "~/components/filters/FieldsFilters";
import { Tooltip } from "~/components/ui/tooltip";
import {
  explainHandledError,
  readHandledError,
  UNKNOWN_ERROR_PRESENTATION,
} from "~/features/errors";
import type { FilterParam } from "~/hooks/useFilterParams";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import {
  type FilterField,
  sanitizeTriggerFilters,
  type TriggerFilterValue,
} from "~/server/filters/types";
import { api } from "~/utils/api";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { queryIsStructurable } from "../logic/conditionQuery";
import {
  type AutomationDraft,
  filterQueryIsSet,
  filtersAreSet,
  isNotifyAction,
  type ReportSourceKind,
  subjectIsSet,
} from "../logic/draftReducer";
import { estimateFiringRate } from "../logic/firingRate";
import { deriveSeriesOptionsFromGraph } from "../logic/seriesOptions";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { ConditionBuilder } from "./ConditionBuilder";
import { type FacetAccordionProps, FacetSection } from "./FacetSection";
import { QueryFilterInput } from "./QueryFilterInput";

/** One-line preview shown when the Subject facet is collapsed. */
function subjectSummary(draft: AutomationDraft): string {
  if (draft.source === "customGraph") {
    return subjectIsSet(draft)
      ? "Watching a graph metric"
      : "Pick a graph and series";
  }
  if (draft.source === "report") {
    return draft.report.sourceKind === "traceQuery"
      ? "Top matching traces"
      : draft.report.sourceKind === "customGraph"
        ? "A custom graph"
        : "A dashboard";
  }
  if (filterQueryIsSet(draft.filterQuery)) return draft.filterQuery!.trim();
  if (filtersAreSet(draft.filters)) return "Structured filters";
  return "No conditions yet";
}

const SUBJECT_HELP = {
  trace:
    "Which incoming traces this automation acts on. It fires when a trace matches every condition you set.",
  customGraph:
    "The metric this alert watches — one series on one of your analytics graphs.",
  report:
    "What this schedule sends: a table of matching traces, a single graph, or a whole dashboard.",
} as const;

/**
 * The Subject facet (ADR-043 facet 3) — "what is it about?". Switches on
 * the preset: trace filters for an automation, a graph + series for an
 * alert, a content source for a report. Reads and writes the draft through
 * the store, so the awkward required-`report` prop the old secondary drawer
 * needed is gone.
 */
export function SubjectSection({
  prefilledGraphId,
  accordion,
}: {
  /** The graph select is locked to this value when the drawer was opened
   *  from a specific chart card (Phase 5.2). */
  prefilledGraphId?: string;
  accordion?: FacetAccordionProps;
}) {
  const draft = useDraft();

  return (
    <FacetSection
      title="Subject"
      help={SUBJECT_HELP[draft.source]}
      accordion={accordion}
      complete={subjectIsSet(draft)}
      summary={subjectSummary(draft)}
    >
      {draft.source === "customGraph" ? (
        <GraphSubject prefilledGraphId={prefilledGraphId} />
      ) : draft.source === "report" ? (
        <ReportSubject />
      ) : (
        <TraceSubject />
      )}
    </FacetSection>
  );
}

/** Alert subject: the custom graph + the series to watch. */
function GraphSubject({ prefilledGraphId }: { prefilledGraphId?: string }) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const isPrefilled = !!prefilledGraphId;

  const graphs = api.graphs.getAll.useQuery(
    { projectId },
    { enabled: !!projectId },
  );
  const selectedGraphQuery = api.graphs.getById.useQuery(
    { projectId, id: draft.customGraphId ?? "" },
    { enabled: !!draft.customGraphId && !!projectId },
  );
  const seriesOptions = useMemo(
    () => deriveSeriesOptionsFromGraph(selectedGraphQuery.data?.graph),
    [selectedGraphQuery.data?.graph],
  );

  const customGraphMissing = draft.customGraphId === null;
  const seriesMissing =
    !!draft.customGraphId && draft.graphAlert.seriesName.length === 0;

  return (
    <VStack align="stretch" gap={4}>
      {/* `disabled` on Field.Root stamps the native attribute through the
          field context, so the control is genuinely inert (keyboard + AT). */}
      <Field.Root invalid={customGraphMissing} disabled={isPrefilled}>
        <Field.Label>Custom graph</Field.Label>
        <NativeSelect.Root disabled={isPrefilled}>
          <NativeSelect.Field
            value={draft.customGraphId ?? ""}
            onChange={(e) => {
              const id = e.target.value || null;
              dispatch({ type: "SET_CUSTOM_GRAPH_ID", value: id });
              // Reset the series — the previous key won't exist on the new graph.
              dispatch({
                type: "SET_GRAPH_ALERT",
                value: { ...draft.graphAlert, seriesName: "" },
              });
            }}
          >
            <option value="">Select a graph…</option>
            {(graphs.data ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name ?? g.id}
                {g.trigger && g.id !== draft.customGraphId
                  ? " — already automated"
                  : ""}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Field.ErrorText>Pick a custom graph to continue.</Field.ErrorText>
        {isPrefilled ? (
          <Field.HelperText>
            Set from the dashboard graph that opened this drawer.
          </Field.HelperText>
        ) : null}
      </Field.Root>

      <Field.Root
        invalid={seriesMissing}
        disabled={!draft.customGraphId || seriesOptions.length === 0}
      >
        <Field.Label>Series</Field.Label>
        <NativeSelect.Root
          disabled={!draft.customGraphId || seriesOptions.length === 0}
        >
          <NativeSelect.Field
            value={draft.graphAlert.seriesName}
            onChange={(e) =>
              dispatch({
                type: "SET_GRAPH_ALERT",
                value: { ...draft.graphAlert, seriesName: e.target.value },
              })
            }
          >
            <option value="">Select a series…</option>
            {seriesOptions.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
        <Field.ErrorText>Pick a series to monitor.</Field.ErrorText>
      </Field.Root>
    </VStack>
  );
}

/** Report subject: what the scheduled digest sends. */
function ReportSubject() {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const report = draft.report;

  const graphs = api.graphs.getAll.useQuery(
    { projectId },
    { enabled: !!projectId && report.sourceKind === "customGraph" },
  );
  const dashboards = api.dashboards.getAll.useQuery(
    { projectId },
    { enabled: !!projectId && report.sourceKind === "dashboard" },
  );

  return (
    <VStack align="stretch" gap={4}>
      <Field.Root>
        <Field.Label>What to send</Field.Label>
        <NativeSelect.Root>
          <NativeSelect.Field
            value={report.sourceKind}
            onChange={(e) =>
              dispatch({
                type: "SET_REPORT",
                value: {
                  ...report,
                  sourceKind: e.target.value as ReportSourceKind,
                },
              })
            }
          >
            <option value="traceQuery">Top matching traces (table)</option>
            <option value="customGraph">A custom graph (chart)</option>
            <option value="dashboard">A dashboard (all graphs)</option>
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </Field.Root>

      {report.sourceKind === "traceQuery" ? (
        <>
          {/* Without this, a "top matching traces" report has no way to say
              WHICH traces it matches — it would just send the newest ones. */}
          <Field.Root>
            <Field.Label>Which traces</Field.Label>
            <TraceQuerySubject
              query={draft.filterQuery ?? ""}
              onChange={(value) =>
                dispatch({ type: "SET_FILTER_QUERY", value })
              }
              cadence={draft.notificationCadence}
              batches
              purpose="report"
            />
          </Field.Root>
          <Field.Root>
            <Field.Label>How many rows</Field.Label>
            <Input
              type="number"
              value={report.topN}
              onChange={(e) =>
                dispatch({
                  type: "SET_REPORT",
                  value: { ...report, topN: Number(e.target.value) || 5 },
                })
              }
            />
          </Field.Root>
        </>
      ) : report.sourceKind === "customGraph" ? (
        <Field.Root invalid={report.customGraphId === null}>
          <Field.Label>Custom graph</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={report.customGraphId ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_REPORT",
                  value: { ...report, customGraphId: e.target.value || null },
                })
              }
            >
              <option value="">Select a graph…</option>
              {(graphs.data ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name ?? g.id}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Field.ErrorText>Pick a graph to send.</Field.ErrorText>
        </Field.Root>
      ) : (
        <Field.Root invalid={report.dashboardId === null}>
          <Field.Label>Dashboard</Field.Label>
          <NativeSelect.Root>
            <NativeSelect.Field
              value={report.dashboardId ?? ""}
              onChange={(e) =>
                dispatch({
                  type: "SET_REPORT",
                  value: { ...report, dashboardId: e.target.value || null },
                })
              }
            >
              <option value="">Select a dashboard…</option>
              {(dashboards.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect.Field>
            <NativeSelect.Indicator />
          </NativeSelect.Root>
          <Field.ErrorText>Pick a dashboard to send.</Field.ErrorText>
        </Field.Root>
      )}
    </VStack>
  );
}

/**
 * Automation subject: the trace-filter query. A saved legacy automation
 * (structured `filters`, no query) keeps the field-based editor so its
 * conditions aren't silently dropped; everything else authors a Traces-V2
 * search query with a live matched-traces preview.
 */
function TraceSubject() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const isLegacy =
    !filterQueryIsSet(draft.filterQuery) && filtersAreSet(draft.filters);

  if (isLegacy) {
    return (
      <VStack align="stretch" gap={2}>
        <Text textStyle="xs" color="fg.muted">
          This automation uses the older structured filters. It keeps working as
          is — clear these conditions to switch it to a search query.
        </Text>
        <FieldsFilters
          filters={draft.filters as Record<FilterField, FilterParam>}
          setFilters={(next) =>
            dispatch({
              type: "SET_FILTERS",
              value: sanitizeTriggerFilters(
                next as Record<string, TriggerFilterValue>,
              ).sanitized as Partial<Record<FilterField, FilterParam>>,
            })
          }
        />
      </VStack>
    );
  }

  return (
    <TraceQuerySubject
      query={draft.filterQuery ?? ""}
      onChange={(value) => dispatch({ type: "SET_FILTER_QUERY", value })}
      cadence={draft.notificationCadence}
      // Persist actions (dataset / annotation writes) fire per match; only
      // notify actions batch on the digest cadence.
      batches={isNotifyAction(draft)}
    />
  );
}

/** One matched trace in the preview: only the fields the light rows render. */
interface PreviewTrace {
  traceId: string;
  name: string;
  timestamp: number;
  status: "ok" | "error" | "warning";
}

const STATUS_DOT_COLOR: Record<PreviewTrace["status"], string> = {
  ok: "green.solid",
  error: "red.solid",
  warning: "orange.solid",
};

const PREVIEW_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const PREVIEW_SORT = { columnId: "time", direction: "desc" as const };
const QUERY_DEBOUNCE_MS = 400;

/**
 * The trace-filter query editor: a Traces-V2 search query bound to the draft,
 * with a live count of matching traces over the last 7 days. The preview runs
 * the exact same compiler the dispatcher validates against, so an invalid query
 * surfaces its parse error here instead of failing silently at save.
 */
function TraceQuerySubject({
  query,
  onChange,
  cadence,
  batches,
  /** A report runs on a schedule and sends the traces that matched in the
   *  window, so it reads as "which traces go in the report", and the per-trace
   *  firing-rate estimate ("about 6 times a day") does not apply to it. */
  purpose = "automation",
}: {
  query: string;
  onChange: (value: string) => void;
  cadence: NotificationCadence;
  batches: boolean;
  purpose?: "automation" | "report";
}) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  // Debounce before hitting the preview endpoint so fluent typing stays local;
  // the window re-anchors to "now" each time the debounced query settles.
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), QUERY_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const trimmed = debounced.trim();
  const timeRange = useMemo(() => {
    const to = Date.now();
    return { from: to - PREVIEW_WINDOW_MS, to };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const preview = api.tracesV2.list.useQuery(
    {
      projectId,
      timeRange,
      sort: PREVIEW_SORT,
      page: 1,
      pageSize: 5,
      query: trimmed,
    },
    {
      enabled: !!projectId && trimmed.length > 0,
      retry: false,
      // A long stale window plus keepPreviousData keeps the last result on
      // screen while a new query resolves, so the preview refreshes in place
      // instead of blanking to a spinner. Focus changes never refetch — the
      // matched set doesn't move fast enough to justify the flicker.
      staleTime: 5 * 60_000,
      keepPreviousData: true,
      refetchOnWindowFocus: false,
    },
  );

  // The builder is the default surface; Code is the raw-query escape hatch.
  // A query too rich for the builder (OR, grouping, free-text) can only live in
  // Code, so an unstructurable value pins the mode there.
  const structurable = queryIsStructurable(query);
  const [mode, setMode] = useState<"builder" | "code">(() =>
    query.trim() === "" || structurable ? "builder" : "code",
  );
  useEffect(() => {
    if (!structurable) setMode("code");
  }, [structurable]);

  return (
    <VStack align="stretch" gap={3}>
      <HStack justify="space-between" align="start" gap={3}>
        <Text textStyle="xs" color="fg.muted" flex={1}>
          {purpose === "report"
            ? "The schedule sends the traces that match these conditions, the same filters you use in the traces view. Leave it empty to send the most recent traces."
            : "The automation fires on every incoming trace that matches these conditions, the same filters you use in the traces view."}
        </Text>
        <SubjectModeToggle
          mode={mode}
          onMode={setMode}
          builderEnabled={structurable}
        />
      </HStack>
      {mode === "builder" ? (
        <ConditionBuilder query={query} onChange={onChange} />
      ) : (
        <VStack align="stretch" gap={2}>
          <QueryFilterInput
            value={query}
            onChange={onChange}
            placeholder="e.g. status:error AND model:gpt-5-mini"
          />
          <HStack gap={1} flexWrap="wrap">
            <Text textStyle="xs" color="fg.muted">
              Try
            </Text>
            {["status:error", "model:gpt*", "cost:>0.1", "has:eval"].map(
              (ex) => (
                <Code
                  key={ex}
                  size="sm"
                  cursor="pointer"
                  onClick={() =>
                    onChange(query.trim() ? `${query.trim()} ${ex}` : ex)
                  }
                >
                  {ex}
                </Code>
              ),
            )}
          </HStack>
        </VStack>
      )}
      <TracePreview
        trimmed={trimmed}
        fetching={preview.isFetching}
        hasData={preview.data != null}
        error={preview.error}
        totalHits={preview.data?.totalHits ?? null}
        sample={preview.data?.items ?? []}
        cadence={cadence}
        batches={batches}
        showFiringRate={purpose === "automation"}
        requireQuery={purpose === "automation"}
      />
    </VStack>
  );
}

/** Builder ⇄ Code switch. Code carries a Beta badge — the raw-query editor is
 *  the power-user path we haven't fully polished yet. Builder is disabled (with
 *  a why) when the current query is too rich to represent structurally. */
function SubjectModeToggle({
  mode,
  onMode,
  builderEnabled,
}: {
  mode: "builder" | "code";
  onMode: (mode: "builder" | "code") => void;
  builderEnabled: boolean;
}) {
  const builderButton = (
    <Button
      size="xs"
      variant={mode === "builder" ? "subtle" : "ghost"}
      borderRadius={0}
      disabled={!builderEnabled}
      onClick={() => onMode("builder")}
    >
      Builder
    </Button>
  );

  return (
    <HStack gap={2} align="center" flexShrink={0}>
      <HStack
        gap={0}
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        overflow="hidden"
      >
        {builderEnabled ? (
          builderButton
        ) : (
          <Tooltip content="This query is too advanced for the builder — simplify it, or keep editing as code.">
            <Box>{builderButton}</Box>
          </Tooltip>
        )}
        <Button
          size="xs"
          variant={mode === "code" ? "subtle" : "ghost"}
          borderRadius={0}
          onClick={() => onMode("code")}
        >
          Code
        </Button>
      </HStack>
      {mode === "code" ? (
        <Badge size="xs" variant="subtle" colorPalette="purple">
          Beta
        </Badge>
      ) : null}
    </HStack>
  );
}

/**
 * The live matched-traces preview under the query editor. Deliberately light:
 * a one-line count ("35 traces matched") plus a short list of trace names, so
 * it reads as a glanceable confirmation rather than a second traces table.
 *
 * It refreshes in place — `keepPreviousData` on the query means the last
 * result stays put while a new one loads, and the only motion is a small
 * spinner in the corner. The full spinner shows only on the very first load
 * (no data yet), so gaining/losing focus never blanks the panel.
 */
function TracePreview({
  trimmed,
  fetching,
  hasData,
  error,
  totalHits,
  sample,
  cadence,
  batches,
  showFiringRate,
  requireQuery,
}: {
  trimmed: string;
  fetching: boolean;
  hasData: boolean;
  /** The preview query's error, passed straight through — handled or not. */
  error: unknown;
  totalHits: number | null;
  sample: PreviewTrace[];
  cadence: NotificationCadence;
  batches: boolean;
  showFiringRate: boolean;
  /** An automation must be scoped — an empty query would act on every trace,
   *  so we say so rather than silently leaving Save disabled. */
  requireQuery: boolean;
}) {
  if (trimmed.length === 0) {
    return (
      <Text textStyle="xs" color={requireQuery ? "orange.fg" : "fg.muted"}>
        {requireQuery
          ? "Add at least one condition."
          : "Add a query above to preview which traces would match."}
      </Text>
    );
  }
  // First load only — once there's data we keep it on screen and refresh in
  // place (see the corner spinner below).
  if (fetching && !hasData) {
    return (
      <HStack gap={2} color="fg.muted">
        <Spinner size="xs" />
        <Text textStyle="xs">Checking matching traces…</Text>
      </HStack>
    );
  }
  if (error && !hasData) {
    // A single xs line under the query editor — too tight for an alert, so it
    // takes the registry's words directly.
    const handled = readHandledError(error);
    const explanation = handled
      ? explainHandledError(handled)
      : UNKNOWN_ERROR_PRESENTATION;

    return (
      <Text textStyle="xs" color="fg.error">
        {explanation.description
          ? `${explanation.title}. ${explanation.description}`
          : explanation.title}
      </Text>
    );
  }
  const subtext =
    showFiringRate && totalHits !== null && totalHits > 0
      ? estimateFiringRate({ matchesLast7Days: totalHits, cadence, batches })
      : "in the last 7 days";
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
      bg="bg.subtle"
    >
      <HStack
        gap={2}
        align="baseline"
        paddingX={3}
        paddingY={2}
        borderBottomWidth={sample.length > 0 ? "1px" : "0"}
        borderColor="border"
      >
        {totalHits === 0 ? (
          <Text textStyle="sm" fontWeight="medium" color="fg.muted">
            No traces matched
          </Text>
        ) : (
          <Text textStyle="sm">
            <Text as="span" fontWeight="semibold">
              {totalHits?.toLocaleString()}
            </Text>{" "}
            {totalHits === 1 ? "trace" : "traces"} matched
          </Text>
        )}
        <Text textStyle="2xs" color="fg.subtle">
          {subtext}
        </Text>
        <Spacer />
        {/* In-place refresh cue — never blanks the list. */}
        {fetching ? <Spinner size="xs" color="fg.subtle" /> : null}
      </HStack>
      {sample.length > 0 ? (
        <VStack
          align="stretch"
          gap={0}
          separator={<Box height="1px" bg="border" />}
        >
          {sample.map((t) => (
            <PreviewTraceRow key={t.traceId} trace={t} />
          ))}
        </VStack>
      ) : null}
    </Box>
  );
}

/** A single matched trace, kept to the essentials: status dot, name, time ago. */
function PreviewTraceRow({ trace }: { trace: PreviewTrace }) {
  return (
    <HStack gap={2.5} paddingX={3} paddingY={1.5} _hover={{ bg: "bg.muted" }}>
      <Box
        boxSize={2}
        borderRadius="full"
        bg={STATUS_DOT_COLOR[trace.status]}
        flexShrink={0}
      />
      <Text textStyle="xs" color="fg" truncate flex={1} minWidth={0}>
        {trace.name || trace.traceId}
      </Text>
      <Text textStyle="2xs" color="fg.subtle" flexShrink={0}>
        {formatTimeAgoCompact(trace.timestamp)}
      </Text>
    </HStack>
  );
}
