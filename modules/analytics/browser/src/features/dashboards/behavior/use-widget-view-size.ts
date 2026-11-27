import { useDrawerEndInset } from "@langwatch/design-system/drawer";
import { useEffect, useState } from "react";

import {
  WIDGET_VIEW_CHROME_PX,
  type WidgetViewSize,
  widgetViewSizePx,
} from "../model/widget-view-size.ts";

const readViewport = () => ({ widthPx: window.innerWidth, heightPx: window.innerHeight });

/**
 * The size Ask Langy draws a widget at, from its card's spans and the room left beside a docked
 * panel, kept current as the window resizes.
 */
export function useWidgetViewSizePx({
  colSpan,
  rowSpan,
}: {
  colSpan: number;
  rowSpan: number;
}): WidgetViewSize {
  const endInsetPx = useDrawerEndInset();
  const [viewport, setViewport] = useState(readViewport);
  useEffect(() => {
    const measure = () => setViewport(readViewport());
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return widgetViewSizePx({
    colSpan,
    rowSpan,
    roomWidthPx: viewport.widthPx - endInsetPx - WIDGET_VIEW_CHROME_PX.widthPx,
    roomHeightPx: viewport.heightPx - WIDGET_VIEW_CHROME_PX.heightPx,
  });
}
