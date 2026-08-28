/**
 * The playground surface: SQL pane + author-HTML pane + page-level params +
 * one sandboxed frame wired to the real LangWatchQL endpoint.
 *
 * The frame path deliberately bypasses `useLangWatchQLQuery`'s controller —
 * that machine models one draft/submitted snapshot, while the bridge needs
 * id-tagged concurrent-ish requests. The raw abortable executor is enough.
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
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

export function CustomChartPlayground({
  projectId,
  warning,
}: {
  projectId: string;
  warning?: string | undefined;
}) {
  const { colorMode } = useColorMode();
  const utils = api.useUtils();

  const firstPreset = CHART_PLAYGROUND_PRESETS[0];
  const [sql, setSql] = useState(firstPreset?.sql ?? "");
  const [html, setHtml] = useState(firstPreset?.html ?? "");
  const [presetName, setPresetName] = useState(firstPreset?.name ?? "");

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

  const timeWindow = overrideWindow ?? pageWindow;

  const [runNonce, setRunNonce] = useState(0);
  const [runHtml, setRunHtml] = useState(firstPreset?.html ?? "");
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
      if (
        !(LWQL_GRANULARITY_STEPS as readonly number[]).includes(
          requestedGranularity,
        )
      ) {
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
            granularitySeconds:
              requestedGranularity as LangWatchQLGranularityStep,
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

  const run = () => {
    setRunHtml(html);
    setRunNonce((n) => n + 1);
    setLogs([]);
  };

  return (
    <VStack align="stretch" gap={4} width="full" paddingBottom={8}>
      {warning !== undefined && (
        <Box
          borderWidth="1px"
          borderColor="orange.400"
          background="orange.subtle"
          borderRadius="md"
          padding={3}
        >
          <Text fontSize="13px">{warning}</Text>
        </Box>
      )}

      <HStack gap={2} flexWrap="wrap">
        <Text fontSize="13px" fontWeight="600">
          Preset
        </Text>
        {CHART_PLAYGROUND_PRESETS.map((preset) => (
          <Button
            key={preset.name}
            size="xs"
            variant={preset.name === presetName ? "solid" : "outline"}
            onClick={() => {
              setPresetName(preset.name);
              setSql(preset.sql);
              setHtml(preset.html);
            }}
          >
            {preset.name}
          </Button>
        ))}
      </HStack>

      <HStack align="stretch" gap={4} flexWrap="wrap">
        <VStack align="stretch" gap={1} flex="1" minWidth="320px">
          <Text fontSize="13px" fontWeight="600">
            SQL (LangWatchQL)
          </Text>
          <Box
            borderWidth="1px"
            borderColor="border"
            borderRadius="md"
            height="220px"
          >
            <MonacoEditor
              height="100%"
              language="sql"
              value={sql}
              theme={colorMode === "dark" ? "vs-dark" : "vs"}
              onChange={(value: string | undefined) => setSql(value ?? "")}
              options={EDITOR_OPTIONS}
            />
          </Box>
        </VStack>
        <VStack align="stretch" gap={1} flex="1" minWidth="320px">
          <Text fontSize="13px" fontWeight="600">
            Chart HTML
          </Text>
          <Box
            borderWidth="1px"
            borderColor="border"
            borderRadius="md"
            height="220px"
          >
            <MonacoEditor
              height="100%"
              language="html"
              value={html}
              theme={colorMode === "dark" ? "vs-dark" : "vs"}
              onChange={(value: string | undefined) => setHtml(value ?? "")}
              options={EDITOR_OPTIONS}
            />
          </Box>
        </VStack>
      </HStack>

      <HStack align="flex-start" gap={8} flexWrap="wrap">
        <Box flex="1" minWidth="320px">
          <LangWatchQLTimeWindowEditor
            value={timeWindow}
            overridden={overrideWindow !== undefined}
            onOverride={setOverrideWindow}
            onFollowPage={() => setOverrideWindow(undefined)}
            onSendableChange={setWindowSendable}
          />
        </Box>
        <Box minWidth="200px">
          <LangWatchQLGranularityPicker
            value={granularity}
            onChange={setGranularity}
          />
        </Box>
        <Button
          alignSelf="flex-end"
          size="sm"
          onClick={run}
          disabled={!windowSendable}
        >
          Run
        </Button>
      </HStack>

      <SandboxedChartFrame
        key={runNonce}
        html={runHtml}
        executeQuery={executeQuery}
        params={frameParams}
        theme={colorMode === "dark" ? "dark" : "light"}
        onLog={appendLog}
      />

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
    </VStack>
  );
}
