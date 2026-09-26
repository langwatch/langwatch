import { useCallback, useEffect, useState } from "react";

import type { ChartFrameRenderReceipt } from "../bridge/frameBridge";
import { useWidgetRenderReceiptStore } from "./widgetRenderReceiptStore";

/**
 * Publishes render receipts to the widget render receipt store and cleans up on unmount.
 *
 * The receipt — what the frame actually painted — is kept per widget so an
 * off-screen agent (Langy) can read this card through `dashboard.getWidgetRender`.
 * It exists only while this card is mounted, so it is dropped when the card leaves
 * the grid.
 *
 * The receipt is also dropped whenever the frame is NOT painting — either the
 * definition failed to parse (`isRendered: false`) or the frame's watchdog tore
 * it down (`onFrameRunningChange(false)`, wired from `SandboxedChartFrame`). A
 * `status: "ok"` receipt from before a teardown is stale, and an off-screen
 * agent must not be told a widget rendered fine when the "stopped responding"
 * panel is on screen instead. Returns that frame-running setter alongside the
 * receipt handler so the caller only forwards two callbacks.
 */
export function useWidgetRenderReceiptPublisher({
  id,
  widgetName,
  dashboardId,
  theme,
  timeWindow,
  isRendered = true,
}: {
  readonly id: string;
  readonly widgetName?: string;
  readonly dashboardId?: string;
  readonly theme: "light" | "dark";
  readonly timeWindow: { start: number; end: number };
  readonly isRendered?: boolean;
}): {
  onRenderReceipt: (receipt: ChartFrameRenderReceipt) => void;
  onFrameRunningChange: (isRunning: boolean) => void;
} {
  const publishReceipt = useWidgetRenderReceiptStore((state) => state.publish);
  const removeReceipt = useWidgetRenderReceiptStore((state) => state.remove);
  const [isFrameRunning, setIsFrameRunning] = useState(true);

  const onRenderReceipt = useCallback(
    (receipt: ChartFrameRenderReceipt) => {
      publishReceipt({
        ...receipt,
        widgetId: id,
        widgetName,
        dashboardId,
        theme,
        timeWindow,
        capturedAt: Date.now(),
      });
    },
    [publishReceipt, id, widgetName, dashboardId, theme, timeWindow],
  );

  useEffect(() => () => removeReceipt(id), [id, removeReceipt]);

  const shouldKeepReceipt = isRendered && isFrameRunning;
  useEffect(() => {
    if (!shouldKeepReceipt) {
      removeReceipt(id);
    }
  }, [shouldKeepReceipt, id, removeReceipt]);

  return { onRenderReceipt, onFrameRunningChange: setIsFrameRunning };
}
