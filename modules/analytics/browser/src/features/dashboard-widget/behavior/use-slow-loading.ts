/**
 * Whether a widget has been loading for long, so its skeleton can say it is still at it.
 * @see modules/analytics/specs/dashboard-widget-frame-states.feature
 */

import { useEffect, useState } from "react";

/** How long a widget loads before its skeleton says "Still loading…". */
export const SLOW_WIDGET_LOADING_MS = 5_000;

export function useSlowLoading({ isLoading }: { isLoading: boolean }): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!isLoading) return;
    const timer = setTimeout(() => setSlow(true), SLOW_WIDGET_LOADING_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);
  return isLoading && slow;
}
