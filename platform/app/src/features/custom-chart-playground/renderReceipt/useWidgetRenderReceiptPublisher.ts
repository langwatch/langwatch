import { useCallback, useEffect } from "react";

import type { ChartFrameRenderReceipt } from "../bridge/frameBridge";
import { useWidgetRenderReceiptStore } from "./widgetRenderReceiptStore";

/**
 * Publishes render receipts to the widget render receipt store and cleans up on unmount.
 *
 * The receipt — what the frame actually painted — is kept per widget so an
 * off-screen agent (Langy) can read this card through `dashboard.getWidgetRender`.
 * It exists only while this card is mounted, so it is dropped when the card leaves
 * the grid.
 */
export function useWidgetRenderReceiptPublisher({
  id,
  widgetName,
  dashboardId,
  theme,
  timeWindow,
}: {
  readonly id: string;
  readonly widgetName?: string;
  readonly dashboardId?: string;
  readonly theme: "light" | "dark";
  readonly timeWindow: { start: number; end: number };
}) {
  const publishReceipt = useWidgetRenderReceiptStore((state) => state.publish);
  const removeReceipt = useWidgetRenderReceiptStore((state) => state.remove);

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

  return onRenderReceipt;
}
