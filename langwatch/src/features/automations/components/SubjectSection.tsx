import {
  Box,
  Code,
  Field,
  HStack,
  Input,
  NativeSelect,
  Spinner,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { FieldsFilters } from "~/components/filters/FieldsFilters";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { FilterParam } from "~/hooks/useFilterParams";
import {
  type FilterField,
  sanitizeTriggerFilters,
  type TriggerFilterValue,
} from "~/server/filters/types";
import { api } from "~/utils/api";
import {
  filterQueryIsSet,
  filtersAreSet,
  type ReportSourceKind,
} from "../logic/draftReducer";
import { estimateFiringRate } from "../logic/firingRate";
import { deriveSeriesOptionsFromGraph } from "../logic/seriesOptions";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { FacetSection } from "./FacetSection";

const SUBJECT_HELP = {
  trace:
    "Which incoming traces this automation acts on. It fires when a trace matches every condition you set.",
  customGraph:
    "The metric this alert watches — one series on one of your analytics graphs.",
  report:
    "What this report sends — a table of matching traces, a single graph, or a whole dashboard.",
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
}: {
  /** The graph select is locked to this value when the drawer was opened
   *  from a specific chart card (Phase 5.2). */
  prefilledGraphId?: string;
}) {
  const draft = useDraft();

  return (
    <FacetSection title="Subject" help={SUBJECT_HELP[draft.source]}>
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
    />
  );
}

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
}: {
  query: string;
  onChange: (value: string) => void;
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
    { enabled: !!projectId && trimmed.length > 0, retry: false },
  );

  return (
    <VStack align="stretch" gap={3}>
      <Text textStyle="xs" color="fg.muted">
        The automation fires on every incoming trace that matches this search
        query — the same one you use in the traces view.
      </Text>
      <Textarea
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder='e.g. status:error AND model:gpt-4o'
        fontFamily="mono"
        fontSize="sm"
        rows={2}
        autoresize
      />
      <HStack gap={1} flexWrap="wrap">
        <Text textStyle="xs" color="fg.muted">
          Try
        </Text>
        {["status:error", "model:gpt*", "cost:>0.1", "has:eval"].map((ex) => (
          <Code
            key={ex}
            size="sm"
            cursor="pointer"
            onClick={() => onChange(query.trim() ? `${query.trim()} ${ex}` : ex)}
          >
            {ex}
          </Code>
        ))}
      </HStack>
      <TracePreview
        trimmed={trimmed}
        loading={preview.isFetching}
        error={preview.error?.message ?? null}
        totalHits={preview.data?.totalHits ?? null}
        sample={preview.data?.items ?? []}
      />
    </VStack>
  );
}

/** The live matched-traces preview under the query editor. */
function TracePreview({
  trimmed,
  loading,
  error,
  totalHits,
  sample,
}: {
  trimmed: string;
  loading: boolean;
  error: string | null;
  totalHits: number | null;
  sample: Array<{ traceId: string; name?: string | null }>;
}) {
  if (trimmed.length === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        Add a query above to preview which traces would match.
      </Text>
    );
  }
  if (loading) {
    return (
      <HStack gap={2} color="fg.muted">
        <Spinner size="xs" />
        <Text textStyle="xs">Checking matching traces…</Text>
      </HStack>
    );
  }
  if (error) {
    return (
      <Text textStyle="xs" color="fg.error">
        {error}
      </Text>
    );
  }
  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      padding={3}
      bg="bg.subtle"
    >
      <Text textStyle="sm" fontWeight="medium">
        {totalHits === 0
          ? "No traces matched in the last 7 days"
          : `${totalHits?.toLocaleString()} ${
              totalHits === 1 ? "trace" : "traces"
            } matched in the last 7 days`}
      </Text>
      {totalHits !== null && totalHits > 0 ? (
        <Text textStyle="xs" color="fg.muted" paddingTop={0.5}>
          {estimateFiringRate(totalHits)}
        </Text>
      ) : null}
      {sample.length > 0 ? (
        <VStack align="stretch" gap={0.5} paddingTop={2}>
          {sample.map((t) => (
            <Text
              key={t.traceId}
              textStyle="xs"
              color="fg.muted"
              truncate
              fontFamily="mono"
            >
              {t.name || t.traceId}
            </Text>
          ))}
        </VStack>
      ) : null}
    </Box>
  );
}
