/**
 * Sends "dashboards.viewed.widget" the first time a widget's card is on screen, once per card
 * mount: a board opened again mounts its cards again. Without IntersectionObserver nothing is
 * sent, since nothing can tell what was seen.
 * @see modules/dashboard/specs/dashboards-telemetry.feature
 */

import { useUiAnalytics } from "@langwatch/browser-host/analytics";
import { useEffect, useRef, useState } from "react";

import { type WidgetSource, widgetViewed } from "../model/dashboard-usage-events.ts";

/** Half a card in view counts as seen. */
const SEEN_SHARE = 0.5;

/** The ref callback to put on the card; it sends one view when the card first shows. */
export function useWidgetViewed({
  widgetSource,
}: {
  widgetSource: WidgetSource;
}): (node: HTMLElement | null) => void {
  const analytics = useUiAnalytics();
  const sent = useRef(false);
  const [node, setNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!node || sent.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (sent.current || !entries.some((entry) => entry.intersectionRatio >= SEEN_SHARE)) return;
        sent.current = true;
        observer.disconnect();
        analytics.track(widgetViewed({ widgetSource }));
      },
      { threshold: SEEN_SHARE },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, analytics, widgetSource]);

  return setNode;
}
