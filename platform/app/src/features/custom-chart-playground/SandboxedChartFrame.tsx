/**
 * The sandboxed chart frame plus its bridge lifecycle.
 *
 * `sandbox="allow-scripts"` and NEVER `allow-same-origin`: the frame runs
 * author code with an opaque origin, no cookies, no parent DOM. All it can do
 * is talk over the transferred MessagePort.
 */

import { Box, Button, Text, VStack } from "@chakra-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ChartFrameParams,
  ChartFrameTheme,
} from "./bridge/bridgeProtocol";
import {
  CHART_FRAME_MAX_HEIGHT_PX,
  CHART_FRAME_MIN_HEIGHT_PX,
} from "./bridge/bridgeProtocol";
import type {
  ChartFrameExecuteQuery,
  ChartFrameLogEntry,
} from "./bridge/frameBridge";
import { createFrameBridge } from "./bridge/frameBridge";
import { buildSrcdoc } from "./buildSrcdoc";

export interface SandboxedChartFrameProps {
  /** The widget's React/TSX source. The frame re-mounts whenever this changes. */
  code: string;
  executeQuery: ChartFrameExecuteQuery;
  /** Initial params; later changes are pushed as `lw:params-change`. */
  params: ChartFrameParams;
  theme: ChartFrameTheme;
  onLog: (entry: ChartFrameLogEntry) => void;
  /**
   * `LW.navigate(target, params)` from the frame. A widget host with no
   * router to navigate with (or that hasn't wired one up yet) can simply
   * omit this — frameBridge no-ops safely when it's absent.
   */
  onNavigate?: (
    target: string,
    params: Readonly<Record<string, unknown>>,
  ) => void;
  /**
   * Upper bound on the frame's rendered height, in px. Defaults to the
   * protocol ceiling. A widget passes its card's row-span height so a taller
   * card gives the chart more room without lifting the bridge's own clamp.
   */
  maxHeight?: number;
}

export function SandboxedChartFrame({
  code,
  executeQuery,
  params,
  theme,
  onLog,
  onNavigate,
  maxHeight = CHART_FRAME_MAX_HEIGHT_PX,
}: SandboxedChartFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [generation, setGeneration] = useState(0);
  const [tornDown, setTornDown] = useState(false);
  // Fills the box the card gives it by default (a taller/wider card grows
  // the chart with it); a widget can still call LW.setHeight to size to its
  // own content instead, which is what onHeightChange below feeds.
  const [height, setHeight] = useState(maxHeight);
  useEffect(() => {
    setHeight(maxHeight);
  }, [maxHeight]);

  const srcdoc = useMemo(() => buildSrcdoc(code), [code]);

  // Callbacks live in refs so the bridge effect does not restart per render.
  const executeQueryRef = useRef(executeQuery);
  executeQueryRef.current = executeQuery;
  const onLogRef = useRef(onLog);
  onLogRef.current = onLog;
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const initialParamsRef = useRef(params);
  const bridgeRef = useRef<ReturnType<typeof createFrameBridge> | null>(null);

  // generation and srcdoc re-key the frame; params/theme are deliberately
  // not dependencies (initial values only — updates travel as lw:params-change).
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const bridge = createFrameBridge({
      iframe,
      executeQuery: (queryName, params, signal) =>
        executeQueryRef.current(queryName, params, signal),
      params: initialParamsRef.current,
      theme,
      onLog: (entry) => onLogRef.current(entry),
      onHeightChange: setHeight,
      onNavigate: (target, navParams) =>
        onNavigateRef.current?.(target, navParams),
      onTeardown: () => setTornDown(true),
    });
    bridgeRef.current = bridge;
    return () => {
      bridgeRef.current = null;
      bridge.dispose();
    };
  }, [generation, srcdoc]);

  // Push param updates into the live frame without re-mounting it.
  useEffect(() => {
    initialParamsRef.current = params;
    bridgeRef.current?.postParamsChange(params);
  }, [params]);

  if (tornDown) {
    return (
      <VStack
        align="center"
        justify="center"
        minHeight="120px"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        gap={2}
        padding={4}
      >
        <Text fontSize="13px" color="fg.muted">
          The frame stopped responding and was torn down.
        </Text>
        <Button
          size="sm"
          onClick={() => {
            setTornDown(false);
            setGeneration((n) => n + 1);
          }}
        >
          Restart
        </Button>
      </VStack>
    );
  }

  return (
    <Box
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
    >
      <iframe
        key={generation}
        ref={iframeRef}
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        title="Custom chart"
        style={{
          width: "100%",
          border: "none",
          display: "block",
          height: `${Math.max(
            CHART_FRAME_MIN_HEIGHT_PX,
            Math.min(Math.min(CHART_FRAME_MAX_HEIGHT_PX, maxHeight), height),
          )}px`,
        }}
      />
    </Box>
  );
}
