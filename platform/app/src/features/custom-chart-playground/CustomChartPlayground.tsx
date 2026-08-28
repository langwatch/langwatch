/**
 * The playground surface: SQL pane + author-HTML pane + page-level params +
 * one sandboxed frame wired to the real LangWatchQL endpoint.
 *
 * The frame path deliberately bypasses `useLangWatchQLQuery`'s controller —
 * that machine models one draft/submitted snapshot, while the bridge needs
 * id-tagged concurrent-ish requests. The raw abortable executor is enough.
 *
 * Layout: one persistent toolbar (time window + granularity + Run) sits
 * above three tabs — Chart, Query, Code — with the frame log always visible
 * below. `Tabs.Root` below is left at its default `lazyMount`/`unmountOnExit`
 * (both false), so all three panels mount immediately and an inactive one is
 * only CSS-hidden: the sandboxed frame's bridge tears itself down 1.5s after
 * its last heartbeat, so switching tabs must never unmount the Chart panel.
 *
 * The component itself is split into small state hooks + presentational
 * pieces below so the exported container stays a short composition (see
 * biome's noExcessiveLinesPerFunction) — none of this changes behavior.
 */

import { Box, Button, HStack, Tabs, Text, VStack } from "@chakra-ui/react";
import type { editor } from "monaco-editor";
import { useCallback, useMemo, useRef, useState } from "react";

import { useColorMode } from "~/components/ui/color-mode";
import { LangWatchQLGranularityPicker } from "~/features/analytics-query/components/LangWatchQLGranularityPicker";
import { LangWatchQLTimeWindowEditor } from "~/features/analytics-query/components/LangWatchQLTimeWindowEditor";
import { createLangWatchQLExecute } from "~/features/analytics-query/logic/lwqlExecute";
import type { LangWatchQLTimeWindowValues } from "~/features/analytics-query/logic/lwqlRequestState";
import { explainAnyError, readHandledError } from "~/features/errors";
import type { LangWatchQLGranularityStep } from "~/server/analytics/lwql/timeWindow";
import { LWQL_GRANULARITY_STEPS } from "~/server/analytics/lwql/timeWindow";
import { api } from "~/utils/api";
import dynamic from "~/utils/compat/next-dynamic";

import type { ChartFrameParams } from "./bridge/bridgeProtocol";
import { toChartQueryResult } from "./bridge/bridgeProtocol";
import type {
  ChartFrameExecuteQuery,
  ChartFrameLogEntry,
} from "./bridge/frameBridge";
import { CHART_PLAYGROUND_PRESETS } from "./presets";
import { SandboxedChartFrame } from "./SandboxedChartFrame";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <Box padding={4} color="fg.muted">
      Loading the editor
    </Box>
  ),
});

const EDITOR_OPTIONS: editor.IStandaloneEditorConstructionOptions = {
  minimap: { enabled: false },
  fontSize: 12,
  wordWrap: "on",
  automaticLayout: true,
  scrollBeyondLastLine: false,
  lineNumbers: "on",
  folding: true,
};

interface AttributedLogEntry extends ChartFrameLogEntry {
  readonly at: number;
  readonly key: number;
}

const LOG_CAP = 200;
type Preset = (typeof CHART_PLAYGROUND_PRESETS)[number];

// ---------------------------------------------------------------------------
// State hooks — each owns one concern so the container stays a short
// composition of state + JSX.
// ---------------------------------------------------------------------------

function usePlaygroundContent(firstPreset: Preset | undefined) {
  const [sql, setSql] = useState(firstPreset?.sql ?? "");
  const [html, setHtml] = useState(firstPreset?.html ?? "");
  const [presetName, setPresetName] = useState(firstPreset?.name ?? "");

  const selectPreset = useCallback((preset: Preset) => {
    setPresetName(preset.name);
    setSql(preset.sql);
    setHtml(preset.html);
  }, []);

  return { sql, setSql, html, setHtml, presetName, selectPreset };
}

function usePlaygroundWindow() {
  // Page-level params. The default window is the last 24 hours, fixed at
  // first render so re-renders do not silently move the window.
  const [pageWindow] = useState<LangWatchQLTimeWindowValues>(() => {
    const end = Date.now();
    return { start: end - 24 * 60 * 60 * 1000, end };
  });
  const [overrideWindow, setOverrideWindow] = useState<
    LangWatchQLTimeWindowValues | undefined
  >(undefined);
  const [windowSendable, setWindowSendable] = useState(true);
  const [granularity, setGranularity] =
    useState<LangWatchQLGranularityStep>(3600);

  return {
    timeWindow: overrideWindow ?? pageWindow,
    overrideWindow,
    setOverrideWindow,
    windowSendable,
    setWindowSendable,
    granularity,
    setGranularity,
  };
}

function useFrameRun(html: string) {
  const [runNonce, setRunNonce] = useState(0);
  const [runHtml, setRunHtml] = useState(html);
  const [logs, setLogs] = useState<AttributedLogEntry[]>([]);
  const logKeyRef = useRef(0);

  const appendLog = useCallback((entry: ChartFrameLogEntry) => {
    setLogs((existing) => {
      logKeyRef.current += 1;
      const next = [
        ...existing,
        { ...entry, at: Date.now(), key: logKeyRef.current },
      ];
      return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
    });
  }, []);

  const run = useCallback(() => {
    setRunHtml(html);
    setRunNonce((n) => n + 1);
    setLogs([]);
  }, [html]);

  return { runNonce, runHtml, logs, appendLog, run };
}

function useMonacoTabSync() {
  // Monaco's automaticLayout option relies on a ResizeObserver that can miss
  // the reveal from a Tabs.Content panel's `hidden` attribute — the editor
  // can measure its box before the panel finishes unhiding. Re-measuring on
  // tab activation (deferred a frame so the DOM has updated) keeps the
  // editor filling its container after a switch.
  const sqlEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const htmlEditorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleTabChange = useCallback((value: string) => {
    requestAnimationFrame(() => {
      if (value === "query") sqlEditorRef.current?.layout();
      if (value === "code") htmlEditorRef.current?.layout();
    });
  }, []);
  const onSqlMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    sqlEditorRef.current = instance;
  }, []);
  const onHtmlMount = useCallback((instance: editor.IStandaloneCodeEditor) => {
    htmlEditorRef.current = instance;
  }, []);

  return { handleTabChange, onSqlMount, onHtmlMount };
}

function isValidGranularity(
  value: number,
): value is LangWatchQLGranularityStep {
  return (LWQL_GRANULARITY_STEPS as readonly number[]).includes(value);
}

interface ChartQueryExecutorArgs {
  utils: ReturnType<typeof api.useUtils>;
  projectId: string;
  sql: string;
  timeWindow: LangWatchQLTimeWindowValues;
  granularity: LangWatchQLGranularityStep;
}

function useChartQueryExecutor({
  utils,
  projectId,
  sql,
  timeWindow,
  granularity,
}: ChartQueryExecutorArgs) {
  // Live values behind refs so the frame's executeQuery — created once per
  // frame mount — always reads what is on screen now.
  const sqlRef = useRef(sql);
  sqlRef.current = sql;
  const windowRef = useRef(timeWindow);
  windowRef.current = timeWindow;
  const granularityRef = useRef(granularity);
  granularityRef.current = granularity;

  const execute = useMemo(
    () => createLangWatchQLExecute({ utils, projectId }),
    [utils, projectId],
  );

  const executeQuery: ChartFrameExecuteQuery = useCallback(
    async (overrides, signal) => {
      const requestedGranularity =
        overrides.granularitySeconds ?? granularityRef.current;
      if (!isValidGranularity(requestedGranularity)) {
        throw {
          code: "lwql_granularity_invalid",
          title: "Invalid granularity",
          message: `granularitySeconds must be one of ${LWQL_GRANULARITY_STEPS.join(", ")}.`,
        };
      }
      try {
        const result = await execute(
          {
            sql: sqlRef.current,
            parameters: {},
            timeWindow: overrides.timeWindow ?? windowRef.current,
            granularitySeconds: requestedGranularity,
          },
          { signal },
        );
        return toChartQueryResult(result);
      } catch (error) {
        // ADR-045: never surface error.message — registry copy only. The
        // lwql_* code rides along so the frame can show something quotable.
        const explained = explainAnyError(error);
        throw {
          code: readHandledError(error)?.code ?? "unknown",
          title: explained.title,
          message: explained.description,
        };
      }
    },
    [execute],
  );

  const frameParams: ChartFrameParams = useMemo(
    () => ({
      timeWindow: { start: timeWindow.start, end: timeWindow.end },
      granularitySeconds: granularity,
    }),
    [timeWindow, granularity],
  );

  return { executeQuery, frameParams };
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function WarningBanner({ text }: { text: string }) {
  return (
    <Box
      borderWidth="1px"
      borderColor="orange.400"
      background="orange.subtle"
      borderRadius="md"
      padding={3}
    >
      <Text fontSize="13px">{text}</Text>
    </Box>
  );
}

function PresetBar({
  activePresetName,
  onSelect,
}: {
  activePresetName: string;
  onSelect: (preset: Preset) => void;
}) {
  return (
    <HStack gap={2} flexWrap="wrap">
      <Text fontSize="13px" fontWeight="600">
        Preset
      </Text>
      {CHART_PLAYGROUND_PRESETS.map((preset) => (
        <Button
          key={preset.name}
          size="xs"
          variant={preset.name === activePresetName ? "solid" : "outline"}
          onClick={() => onSelect(preset)}
        >
          {preset.name}
        </Button>
      ))}
    </HStack>
  );
}

interface PlaygroundToolbarProps {
  windowState: ReturnType<typeof usePlaygroundWindow>;
  onRun: () => void;
  runDisabled: boolean;
}

// Persistent toolbar — stays visible on every tab, deliberately outside the
// tab panels so Run never moves.
function PlaygroundToolbar({
  windowState,
  onRun,
  runDisabled,
}: PlaygroundToolbarProps) {
  return (
    <HStack align="flex-start" gap={8} flexWrap="wrap">
      <Box flex="1" minWidth="320px">
        <LangWatchQLTimeWindowEditor
          value={windowState.timeWindow}
          overridden={windowState.overrideWindow !== undefined}
          onOverride={windowState.setOverrideWindow}
          onFollowPage={() => windowState.setOverrideWindow(undefined)}
          onSendableChange={windowState.setWindowSendable}
        />
      </Box>
      <Box minWidth="200px">
        <LangWatchQLGranularityPicker
          value={windowState.granularity}
          onChange={windowState.setGranularity}
        />
      </Box>
      <Button
        alignSelf="flex-end"
        size="sm"
        onClick={onRun}
        disabled={runDisabled}
      >
        Run
      </Button>
    </HStack>
  );
}

interface ChartTabPanelProps {
  runNonce: number;
  runHtml: string;
  executeQuery: ChartFrameExecuteQuery;
  frameParams: ChartFrameParams;
  theme: "dark" | "light";
  onLog: (entry: ChartFrameLogEntry) => void;
}

function ChartTabPanel({
  runNonce,
  runHtml,
  executeQuery,
  frameParams,
  theme,
  onLog,
}: ChartTabPanelProps) {
  return (
    <Tabs.Content value="chart" paddingTop={4}>
      <SandboxedChartFrame
        key={runNonce}
        html={runHtml}
        executeQuery={executeQuery}
        params={frameParams}
        theme={theme}
        onLog={onLog}
      />
    </Tabs.Content>
  );
}

interface MonacoTabPanelProps {
  tabValue: "query" | "code";
  label: string;
  language: "sql" | "html";
  value: string;
  theme: "vs-dark" | "vs";
  onChange: (value: string) => void;
  onMount: (editorInstance: editor.IStandaloneCodeEditor) => void;
}

function MonacoTabPanel({
  tabValue,
  label,
  language,
  value,
  theme,
  onChange,
  onMount,
}: MonacoTabPanelProps) {
  return (
    <Tabs.Content value={tabValue} paddingTop={4}>
      <VStack align="stretch" gap={1}>
        <Text fontSize="13px" fontWeight="600">
          {label}
        </Text>
        <Box
          borderWidth="1px"
          borderColor="border"
          borderRadius="md"
          height="220px"
        >
          <MonacoEditor
            height="100%"
            language={language}
            value={value}
            theme={theme}
            onChange={(v: string | undefined) => onChange(v ?? "")}
            onMount={onMount}
            options={EDITOR_OPTIONS}
          />
        </Box>
      </VStack>
    </Tabs.Content>
  );
}

interface PlaygroundTabsProps {
  onTabChange: (value: string) => void;
  runNonce: number;
  runHtml: string;
  executeQuery: ChartFrameExecuteQuery;
  frameParams: ChartFrameParams;
  chartTheme: "dark" | "light";
  onLog: (entry: ChartFrameLogEntry) => void;
  sql: string;
  onSqlChange: (value: string) => void;
  onSqlMount: (editorInstance: editor.IStandaloneCodeEditor) => void;
  html: string;
  onHtmlChange: (value: string) => void;
  onHtmlMount: (editorInstance: editor.IStandaloneCodeEditor) => void;
  monacoTheme: "vs-dark" | "vs";
}

// The single tab container: Chart (default active) | Query | Code. No
// lazyMount/unmountOnExit set, so Chakra keeps every Tabs.Content mounted —
// an inactive panel is CSS-hidden only, never unmounted. That is required
// for the Chart panel's sandboxed iframe (its bridge tears down 1.5s after
// its last heartbeat) and kept the same way for both Monaco panels.
function PlaygroundTabs(props: PlaygroundTabsProps) {
  return (
    <Tabs.Root
      defaultValue="chart"
      variant="line"
      size="sm"
      onValueChange={(e) => props.onTabChange(e.value)}
    >
      <Tabs.List borderBottomWidth="1px" borderColor="border">
        <Tabs.Trigger value="chart">Chart</Tabs.Trigger>
        <Tabs.Trigger value="query">Query</Tabs.Trigger>
        <Tabs.Trigger value="code">Code</Tabs.Trigger>
      </Tabs.List>

      <ChartTabPanel
        runNonce={props.runNonce}
        runHtml={props.runHtml}
        executeQuery={props.executeQuery}
        frameParams={props.frameParams}
        theme={props.chartTheme}
        onLog={props.onLog}
      />
      <MonacoTabPanel
        tabValue="query"
        label="SQL (LangWatchQL)"
        language="sql"
        value={props.sql}
        theme={props.monacoTheme}
        onChange={props.onSqlChange}
        onMount={props.onSqlMount}
      />
      <MonacoTabPanel
        tabValue="code"
        label="Chart HTML"
        language="html"
        value={props.html}
        theme={props.monacoTheme}
        onChange={props.onHtmlChange}
        onMount={props.onHtmlMount}
      />
    </Tabs.Root>
  );
}

function FrameLogPanel({ logs }: { logs: AttributedLogEntry[] }) {
  return (
    <VStack align="stretch" gap={1}>
      <Text fontSize="13px" fontWeight="600">
        Frame log
      </Text>
      <Box
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        padding={2}
        maxHeight="220px"
        overflowY="auto"
        fontFamily="mono"
        fontSize="12px"
        data-testid="chart-frame-log"
      >
        {logs.length === 0 ? (
          <Text color="fg.muted">Nothing yet.</Text>
        ) : (
          logs.map((entry) => (
            <Text
              key={entry.key}
              color={
                entry.level === "error"
                  ? "red.500"
                  : entry.level === "warn"
                    ? "orange.500"
                    : "fg"
              }
            >
              {`[${new Date(entry.at).toISOString().slice(11, 23)}] [${entry.source}] [${entry.level}] ${entry.text}`}
            </Text>
          ))
        )}
      </Box>
    </VStack>
  );
}

// ---------------------------------------------------------------------------
// Container
// ---------------------------------------------------------------------------

export function CustomChartPlayground({
  projectId,
  warning,
}: {
  projectId: string;
  warning?: string | undefined;
}) {
  const { colorMode } = useColorMode();
  const utils = api.useUtils();
  const monacoTheme = colorMode === "dark" ? "vs-dark" : "vs";

  const content = usePlaygroundContent(CHART_PLAYGROUND_PRESETS[0]);
  const windowState = usePlaygroundWindow();
  const frameRun = useFrameRun(content.html);
  const monacoTabSync = useMonacoTabSync();
  const { executeQuery, frameParams } = useChartQueryExecutor({
    utils,
    projectId,
    sql: content.sql,
    timeWindow: windowState.timeWindow,
    granularity: windowState.granularity,
  });

  return (
    <VStack align="stretch" gap={4} width="full" paddingBottom={8}>
      {warning !== undefined && <WarningBanner text={warning} />}

      <PresetBar
        activePresetName={content.presetName}
        onSelect={content.selectPreset}
      />

      <PlaygroundToolbar
        windowState={windowState}
        onRun={frameRun.run}
        runDisabled={!windowState.windowSendable}
      />

      <PlaygroundTabs
        onTabChange={monacoTabSync.handleTabChange}
        runNonce={frameRun.runNonce}
        runHtml={frameRun.runHtml}
        executeQuery={executeQuery}
        frameParams={frameParams}
        chartTheme={colorMode === "dark" ? "dark" : "light"}
        onLog={frameRun.appendLog}
        sql={content.sql}
        onSqlChange={content.setSql}
        onSqlMount={monacoTabSync.onSqlMount}
        html={content.html}
        onHtmlChange={content.setHtml}
        onHtmlMount={monacoTabSync.onHtmlMount}
        monacoTheme={monacoTheme}
      />

      <FrameLogPanel logs={frameRun.logs} />
    </VStack>
  );
}
