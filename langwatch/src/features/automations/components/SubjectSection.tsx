import {
  Box,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { Monaco } from "@monaco-editor/react";
import { useMemo, useState } from "react";
import { FieldsFilters } from "~/components/filters/FieldsFilters";
import { Switch } from "~/components/ui/switch";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { FilterParam } from "~/hooks/useFilterParams";
import {
  type FilterField,
  sanitizeTriggerFilters,
  type TriggerFilterValue,
  triggerFiltersPermissiveSchema,
} from "~/server/filters/types";
import { api } from "~/utils/api";
import dynamic from "~/utils/compat/next-dynamic";
import {
  monacoBackgroundFor,
  trapEscapeInsideEditor,
} from "../editors/monacoEditorChrome";
import {
  CONDITIONS_JSON_SCHEMA,
  CONDITIONS_MODEL_URI,
  registerJsonSchema,
} from "../editors/monacoSchemas";
import { useMonacoTheme } from "../editors/useMonacoTheme";
import type { ReportSourceKind } from "../logic/draftReducer";
import { deriveSeriesOptionsFromGraph } from "../logic/seriesOptions";
import { useAutomationStore } from "../state/automationStore";
import { useDraft } from "../state/selectors";
import { FacetSection } from "./FacetSection";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

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

/** Automation subject: the trace filters, visual or JSON code mode. */
function TraceSubject() {
  const draft = useDraft();
  const dispatch = useAutomationStore((s) => s.dispatch);
  const theme = useMonacoTheme();
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState(() =>
    JSON.stringify(draft.filters, null, 2),
  );
  const [codeError, setCodeError] = useState<string | null>(null);

  const commitCode = (raw: string): boolean => {
    try {
      const parsed = JSON.parse(raw);
      const result = triggerFiltersPermissiveSchema.safeParse(parsed);
      if (!result.success) {
        setCodeError(result.error.errors[0]?.message ?? "Invalid filters");
        return false;
      }
      const { sanitized } = sanitizeTriggerFilters(result.data);
      dispatch({
        type: "SET_FILTERS",
        value: sanitized as Partial<Record<FilterField, FilterParam>>,
      });
      setCodeError(null);
      return true;
    } catch {
      setCodeError("Invalid JSON syntax");
      return false;
    }
  };

  const onToggleCode = (toCode: boolean) => {
    if (toCode) {
      setCode(JSON.stringify(draft.filters, null, 2));
      setCodeError(null);
    } else if (!commitCode(code)) {
      // Stay in code mode until the JSON is valid, so the switch never
      // silently drops an in-progress edit.
      return;
    }
    setCodeMode(toCode);
  };

  return (
    <VStack align="stretch" gap={2}>
      <HStack justify="flex-end" gap={2}>
        <Text textStyle="sm" color="fg.muted">
          Code
        </Text>
        <Switch
          checked={codeMode}
          onCheckedChange={({ checked }) => onToggleCode(checked)}
        />
      </HStack>
      {codeMode ? (
        <>
          <Box
            border="1px solid"
            borderColor={codeError ? "red.500" : "border"}
            borderRadius="md"
            overflow="hidden"
            height="360px"
            background={monacoBackgroundFor(theme)}
          >
            <MonacoEditor
              height="100%"
              language="json"
              path={CONDITIONS_MODEL_URI}
              value={code}
              theme={theme}
              beforeMount={(monaco: Monaco) => {
                registerJsonSchema(
                  monaco,
                  CONDITIONS_MODEL_URI,
                  CONDITIONS_JSON_SCHEMA,
                );
              }}
              onMount={trapEscapeInsideEditor}
              onChange={(v: string | undefined) => {
                const next = v ?? "{}";
                setCode(next);
                // Live-commit so the save gate tracks the edit; invalid JSON
                // just parks the error until it parses.
                commitCode(next);
              }}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                wordWrap: "on",
                automaticLayout: true,
                scrollBeyondLastLine: false,
                lineNumbers: "on",
                tabSize: 2,
                padding: { top: 12 },
              }}
            />
          </Box>
          {codeError ? (
            <Text color="red.500" textStyle="sm">
              {codeError}
            </Text>
          ) : null}
        </>
      ) : (
        <>
          <Text textStyle="xs" color="fg.muted">
            The automation fires when an incoming trace matches every condition
            you set below.
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
        </>
      )}
    </VStack>
  );
}
