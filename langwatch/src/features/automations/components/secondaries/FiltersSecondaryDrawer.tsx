import {
  Box,
  Field,
  HStack,
  Input,
  NativeSelect,
  Text,
  VStack,
} from "@chakra-ui/react";
import { AlertType } from "@prisma/client";
import type { Monaco } from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { deriveSeriesIdentifier } from "~/components/analytics/seriesIdentifier";
import { FieldsFilters } from "~/components/filters/FieldsFilters";
import { Switch } from "~/components/ui/switch";
import type { FilterParam } from "~/hooks/useFilterParams";
import {
  type FilterField,
  sanitizeTriggerFilters,
  type TriggerFilterValue,
  triggerFiltersPermissiveSchema,
} from "~/server/filters/types";
import {
  GRAPH_ALERT_TIME_PERIODS,
  type GraphAlertOperator,
  type GraphAlertTimePeriod,
} from "~/server/app-layer/triggers/graph-alert.builder";
import { api } from "~/utils/api";
import dynamic from "~/utils/compat/next-dynamic";
import {
  monacoBackgroundFor,
  trapEscapeInsideEditor,
} from "../../editors/monacoEditorChrome";
import {
  CONDITIONS_JSON_SCHEMA,
  CONDITIONS_MODEL_URI,
  registerJsonSchema,
} from "../../editors/monacoSchemas";
import { useMonacoTheme } from "../../editors/useMonacoTheme";
import {
  type ConditionSource,
  type GraphAlertDraft,
  INITIAL_GRAPH_ALERT_DRAFT,
  OPERATOR_LABELS,
  TIME_PERIOD_LABELS,
} from "../../logic/draftReducer";
import { SourceCard } from "../SourceCard";
import { SecondaryDrawerShell } from "./SecondaryDrawerShell";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading editor...
    </Box>
  ),
});

export interface FiltersDrawerResult {
  source: ConditionSource;
  filters: Partial<Record<FilterField, FilterParam>>;
  customGraphId: string | null;
  graphAlert: GraphAlertDraft;
  alertType: AlertType | null;
}

interface GraphSeriesOption {
  key: string;
  label: string;
}

/**
 * Builds the series-key + label list a custom graph's JSON exposes for
 * alert authoring. Matches the format the dispatcher reads ("`{index}/{key
 * | metric}/{aggregation}`") so the saved `seriesName` lines up with what
 * the chart data is keyed by at evaluation time.
 *
 * Defensive: a hand-edited / malformed `graph` JSON falls back to an empty
 * list so the picker still renders without crashing — the user just sees
 * "Pick a graph with a configured series" copy below.
 */
function deriveSeriesOptionsFromGraph(graph: unknown): GraphSeriesOption[] {
  if (!graph || typeof graph !== "object") return [];
  const candidate = (graph as { series?: unknown }).series;
  if (!Array.isArray(candidate)) return [];
  return candidate
    .map((entry, index): GraphSeriesOption | null => {
      const seriesKey = deriveSeriesIdentifier(graph, index);
      if (!seriesKey) return null;
      const s = (entry ?? {}) as Record<string, unknown>;
      const tail = seriesKey.split("/").slice(1).join(" / ");
      const label =
        (typeof s.name === "string" && s.name.length > 0 ? s.name : null) ??
        `Series ${index + 1}: ${tail}`;
      return { key: seriesKey, label };
    })
    .filter((o): o is GraphSeriesOption => o !== null);
}

/**
 * Conditions secondary drawer. Lets the author pick the trigger source
 * (trace data vs custom graph), then either configure trace filters
 * (visual + JSON code mode with a registered JSON Schema) or pick a
 * custom graph and define a threshold rule (series, operator, threshold,
 * time window, severity).
 */
export function FiltersSecondaryDrawer({
  open,
  source,
  filters,
  customGraphId,
  graphAlert,
  alertType,
  projectId,
  prefilledGraphId,
  prefilledSeriesName,
  onSave,
  onCancel,
}: {
  open: boolean;
  source: ConditionSource;
  filters: Partial<Record<FilterField, FilterParam>>;
  customGraphId: string | null;
  graphAlert: GraphAlertDraft;
  alertType: AlertType | null;
  projectId: string;
  /** When set, the graph-id field is initialised to this value and locked
   *  — the drawer was launched from a specific chart card (Phase 5.2). */
  prefilledGraphId?: string;
  /** Companion to `prefilledGraphId` — the series the chart card asked us
   *  to monitor. Locked alongside the graph field. */
  prefilledSeriesName?: string;
  onSave: (result: FiltersDrawerResult) => void;
  onCancel: () => void;
}) {
  const [localSource, setLocalSource] = useState<ConditionSource>(source);
  const [local, setLocal] = useState(filters);
  const [localCustomGraphId, setLocalCustomGraphId] = useState<string | null>(
    customGraphId,
  );
  const [localGraphAlert, setLocalGraphAlert] =
    useState<GraphAlertDraft>(graphAlert);
  const [localAlertType, setLocalAlertType] = useState<AlertType>(
    alertType ?? AlertType.WARNING,
  );
  const [codeMode, setCodeMode] = useState(false);
  const [code, setCode] = useState(JSON.stringify(filters, null, 2));
  const [codeError, setCodeError] = useState<string | null>(null);
  const theme = useMonacoTheme();

  useEffect(() => {
    if (open) {
      setLocalSource(source);
      setLocal(filters);
      setLocalCustomGraphId(customGraphId);
      setLocalGraphAlert(graphAlert);
      setLocalAlertType(alertType ?? AlertType.WARNING);
      setCode(JSON.stringify(filters, null, 2));
      setCodeError(null);
    }
  }, [open, source, filters, customGraphId, graphAlert, alertType]);

  const graphs = api.graphs.getAll.useQuery(
    { projectId },
    { enabled: open && localSource === "customGraph" && !!projectId },
  );

  // Pull the selected graph's series shape so the series picker shows
  // labels the author can reason about ("p95 latency" not "0/latency/p95").
  const selectedGraphQuery = api.graphs.getById.useQuery(
    { projectId, id: localCustomGraphId ?? "" },
    {
      enabled:
        open && localSource === "customGraph" && !!localCustomGraphId && !!projectId,
    },
  );

  const seriesOptions = useMemo<GraphSeriesOption[]>(
    () => deriveSeriesOptionsFromGraph(selectedGraphQuery.data?.graph),
    [selectedGraphQuery.data?.graph],
  );

  const onToggleCode = (toCode: boolean) => {
    if (toCode) {
      setCode(JSON.stringify(local, null, 2));
    } else {
      try {
        const parsed = JSON.parse(code);
        const result = triggerFiltersPermissiveSchema.safeParse(parsed);
        if (!result.success) {
          setCodeError(result.error.errors[0]?.message ?? "Invalid filters");
          return;
        }
        const { sanitized } = sanitizeTriggerFilters(result.data);
        setLocal(sanitized as Partial<Record<FilterField, FilterParam>>);
        setCodeError(null);
      } catch {
        setCodeError("Invalid JSON syntax");
        return;
      }
    }
    setCodeMode(toCode);
  };

  const apply = () => {
    if (localSource === "customGraph") {
      onSave({
        source: "customGraph",
        filters: {},
        customGraphId: localCustomGraphId,
        graphAlert: localGraphAlert,
        alertType: localAlertType,
      });
      return;
    }
    if (codeMode) {
      try {
        const parsed = JSON.parse(code);
        const result = triggerFiltersPermissiveSchema.safeParse(parsed);
        if (!result.success) {
          setCodeError(result.error.errors[0]?.message ?? "Invalid filters");
          return;
        }
        const { sanitized } = sanitizeTriggerFilters(result.data);
        onSave({
          source: "trace",
          filters: sanitized as Partial<Record<FilterField, FilterParam>>,
          customGraphId: null,
          graphAlert: INITIAL_GRAPH_ALERT_DRAFT,
          alertType: localAlertType,
        });
      } catch {
        setCodeError("Invalid JSON syntax");
      }
    } else {
      const { sanitized } = sanitizeTriggerFilters(
        local as Record<string, TriggerFilterValue>,
      );
      onSave({
        source: "trace",
        filters: sanitized as Partial<Record<FilterField, FilterParam>>,
        customGraphId: null,
        graphAlert: INITIAL_GRAPH_ALERT_DRAFT,
        alertType: localAlertType,
      });
    }
  };

  const customGraphMissing =
    localSource === "customGraph" && !localCustomGraphId;
  const seriesMissing =
    localSource === "customGraph" &&
    !!localCustomGraphId &&
    !localGraphAlert.seriesName;
  const isPrefilled = !!prefilledGraphId;

  return (
    <SecondaryDrawerShell
      open={open}
      title="When"
      onClose={onCancel}
      onDone={apply}
      doneDisabled={customGraphMissing || seriesMissing}
      headerRight={
        localSource === "trace" ? (
          <>
            <Text textStyle="sm" color="fg.muted">
              Code
            </Text>
            <Switch
              checked={codeMode}
              onCheckedChange={({ checked }) => onToggleCode(checked)}
            />
          </>
        ) : null
      }
    >
      <Box mb={4}>
        <Text textStyle="xs" fontWeight="semibold" color="fg.muted" mb={2}>
          Source
        </Text>
        <HStack gap={2}>
          <SourceCard
            active={localSource === "trace"}
            title="Trace data"
            description="Match on incoming traces using filter fields."
            onClick={() => !isPrefilled && setLocalSource("trace")}
          />
          <SourceCard
            active={localSource === "customGraph"}
            title="Custom graph"
            description="Fire when a custom graph metric crosses a threshold."
            onClick={() => !isPrefilled && setLocalSource("customGraph")}
          />
        </HStack>
      </Box>
      {localSource === "customGraph" ? (
        <VStack align="stretch" gap={4}>
          <Field.Root invalid={customGraphMissing}>
            <Field.Label>Custom graph</Field.Label>
            <NativeSelect.Root disabled={isPrefilled}>
              <NativeSelect.Field
                value={localCustomGraphId ?? ""}
                onChange={(e) => {
                  const id = e.target.value || null;
                  setLocalCustomGraphId(id);
                  // Reset series selection when the graph changes — the
                  // previous selection's key won't exist on the new one.
                  setLocalGraphAlert((prev) => ({ ...prev, seriesName: "" }));
                }}
              >
                <option value="">Select a graph…</option>
                {(graphs.data ?? []).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name ?? g.id}
                    {g.trigger && g.id !== customGraphId
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

          <Field.Root invalid={seriesMissing}>
            <Field.Label>Series</Field.Label>
            <NativeSelect.Root
              disabled={
                isPrefilled ||
                !localCustomGraphId ||
                seriesOptions.length === 0
              }
            >
              <NativeSelect.Field
                value={localGraphAlert.seriesName}
                onChange={(e) =>
                  setLocalGraphAlert((prev) => ({
                    ...prev,
                    seriesName: e.target.value,
                  }))
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

          <HStack gap={3}>
            <Field.Root flex="1">
              <Field.Label>Operator</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={localGraphAlert.operator}
                  onChange={(e) =>
                    setLocalGraphAlert((prev) => ({
                      ...prev,
                      operator: e.target.value as GraphAlertOperator,
                    }))
                  }
                >
                  <option value="gt">Greater than</option>
                  <option value="lt">Less than</option>
                  <option value="gte">Greater than or equal</option>
                  <option value="lte">Less than or equal</option>
                  <option value="eq">Equal to</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
            <Field.Root flex="1">
              <Field.Label>Threshold</Field.Label>
              <Input
                type="number"
                step="any"
                value={Number.isFinite(localGraphAlert.threshold)
                  ? localGraphAlert.threshold
                  : 0}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setLocalGraphAlert((prev) => ({
                    ...prev,
                    threshold: Number.isFinite(next) ? next : 0,
                  }));
                }}
              />
            </Field.Root>
          </HStack>

          <HStack gap={3}>
            <Field.Root flex="1">
              <Field.Label>Time window</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={localGraphAlert.timePeriod}
                  onChange={(e) =>
                    setLocalGraphAlert((prev) => ({
                      ...prev,
                      timePeriod: Number(e.target.value) as GraphAlertTimePeriod,
                    }))
                  }
                >
                  {GRAPH_ALERT_TIME_PERIODS.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {TIME_PERIOD_LABELS[minutes]}
                    </option>
                  ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
            <Field.Root flex="1">
              <Field.Label>Severity</Field.Label>
              <NativeSelect.Root>
                <NativeSelect.Field
                  value={localAlertType}
                  onChange={(e) =>
                    setLocalAlertType(e.target.value as AlertType)
                  }
                >
                  <option value={AlertType.INFO}>Info</option>
                  <option value={AlertType.WARNING}>Warning</option>
                  <option value={AlertType.CRITICAL}>Critical</option>
                </NativeSelect.Field>
                <NativeSelect.Indicator />
              </NativeSelect.Root>
            </Field.Root>
          </HStack>

          <Text textStyle="xs" color="fg.muted">
            Fires when {OPERATOR_LABELS[localGraphAlert.operator]}{" "}
            {localGraphAlert.threshold} over{" "}
            {TIME_PERIOD_LABELS[localGraphAlert.timePeriod]}. Pick the
            notification channel below under Type.
          </Text>
        </VStack>
      ) : codeMode ? (
        <VStack align="stretch" gap={2}>
          <Box
            border="1px solid"
            borderColor={codeError ? "red.500" : "border"}
            borderRadius="md"
            overflow="hidden"
            height="500px"
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
              onChange={(v: string | undefined) => setCode(v ?? "{}")}
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
        </VStack>
      ) : (
        <VStack align="stretch" gap={2}>
          <Text textStyle="xs" color="fg.muted">
            The automation fires when an incoming trace matches every condition
            you set below.
          </Text>
          <FieldsFilters
            filters={local as Record<FilterField, FilterParam>}
            setFilters={(next) => setLocal(next)}
          />
        </VStack>
      )}
    </SecondaryDrawerShell>
  );
}
