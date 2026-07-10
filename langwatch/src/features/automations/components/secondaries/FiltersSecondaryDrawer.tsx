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
import { AlertType } from "@prisma/client";
import { useEffect, useMemo, useState } from "react";
import { FieldsFilters } from "~/components/filters/FieldsFilters";
import { Switch } from "~/components/ui/switch";
import type { FilterParam } from "~/hooks/useFilterParams";
import {
  GRAPH_ALERT_TIME_PERIODS,
  type GraphAlertOperator,
  type GraphAlertTimePeriod,
} from "~/server/app-layer/triggers/graph-alert.builder";
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
import {
  deriveSeriesOptionsFromGraph,
  type GraphSeriesOption,
} from "../../logic/seriesOptions";
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

/**
 * Conditions secondary drawer. Lets the author pick the trigger source
 * (trace data vs custom graph), then either configure trace filters
 * (visual + JSON code mode with a registered JSON Schema) or pick a
 * custom graph and define a threshold rule (series, operator, threshold,
 * time window). Severity lives next to the name on the main drawer; when
 * an alert draft has none yet, Done seeds the Warning default so a fresh
 * alert can save without a detour.
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
  sourceLocked = false,
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
  /** The draft's source can't change anymore (e.g. editing a saved graph
   *  alert). The unselected source card renders with an explicit locked
   *  treatment instead of silently ignoring clicks. */
  sourceLocked?: boolean;
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
  // The threshold is held as text while editing so intermediate states
  // ("-", "1e", empty) don't get coerced mid-keystroke; it parses on Done.
  const [thresholdText, setThresholdText] = useState(
    String(graphAlert.threshold),
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
      setThresholdText(String(graphAlert.threshold));
      setCode(JSON.stringify(filters, null, 2));
      setCodeError(null);
    }
  }, [open, source, filters, customGraphId, graphAlert]);

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
        open &&
        localSource === "customGraph" &&
        !!localCustomGraphId &&
        !!projectId,
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

  const parsedThreshold =
    thresholdText.trim() === "" ? NaN : Number(thresholdText);
  const thresholdInvalid =
    localSource === "customGraph" && !Number.isFinite(parsedThreshold);

  const apply = () => {
    if (localSource === "customGraph") {
      if (thresholdInvalid) return;
      onSave({
        source: "customGraph",
        filters: {},
        customGraphId: localCustomGraphId,
        graphAlert: { ...localGraphAlert, threshold: parsedThreshold },
        // Severity is edited next to the name on the main drawer; alerts
        // require one, so an unset draft is seeded with the default here.
        alertType: alertType ?? AlertType.WARNING,
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
          alertType,
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
        alertType,
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
  const sourceIsLocked = isPrefilled || sourceLocked;

  return (
    <SecondaryDrawerShell
      open={open}
      title="When"
      onClose={onCancel}
      onDone={apply}
      doneDisabled={customGraphMissing || seriesMissing || thresholdInvalid}
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
            locked={sourceIsLocked && localSource !== "trace"}
            lockedTooltip="This automation watches a graph. Create a new automation to trigger on trace data."
            onClick={() => !sourceIsLocked && setLocalSource("trace")}
          />
          <SourceCard
            active={localSource === "customGraph"}
            title="Custom graph"
            description="Fire when a custom graph metric crosses a threshold."
            locked={sourceIsLocked && localSource !== "customGraph"}
            lockedTooltip="This automation watches trace data. Create a new automation to trigger on a graph."
            onClick={() => !sourceIsLocked && setLocalSource("customGraph")}
          />
        </HStack>
      </Box>
      {localSource === "customGraph" ? (
        <VStack align="stretch" gap={4}>
          {/* `disabled` lives on Field.Root — the field context is what
              actually stamps the native attribute on the select, so the
              control is genuinely inert (keyboard + AT included), not just
              styled as disabled. */}
          <Field.Root invalid={customGraphMissing} disabled={isPrefilled}>
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

          {/* Deliberately NOT locked when prefilled — the entry point's
              series is a starting default, not a cage; the author can
              point the alert at any series on the locked graph. */}
          <Field.Root
            invalid={seriesMissing}
            disabled={!localCustomGraphId || seriesOptions.length === 0}
          >
            <Field.Label>Series</Field.Label>
            <NativeSelect.Root
              disabled={!localCustomGraphId || seriesOptions.length === 0}
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
                value={thresholdText}
                onChange={(e) => setThresholdText(e.target.value)}
              />
            </Field.Root>
          </HStack>

          <Field.Root>
            <Field.Label>Time window</Field.Label>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={localGraphAlert.timePeriod}
                onChange={(e) =>
                  setLocalGraphAlert((prev) => ({
                    ...prev,
                    timePeriod: Number(
                      e.target.value,
                    ) as GraphAlertTimePeriod,
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

          <Text textStyle="xs" color="fg.muted">
            Fires when{" "}
            {seriesOptions.find((s) => s.key === localGraphAlert.seriesName)
              ?.label ?? "the selected series"}{" "}
            is {OPERATOR_LABELS[localGraphAlert.operator]}{" "}
            {Number.isFinite(parsedThreshold) ? parsedThreshold : "…"} over{" "}
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
