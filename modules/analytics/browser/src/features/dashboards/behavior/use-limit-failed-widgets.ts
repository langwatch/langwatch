/**
 * Which widgets on a board ended on a resource limit, as each card's frame reports it, so the
 * board can say so once (dashboard-widget-frame-states.feature).
 */

import { useState } from "react";

export function useLimitFailedWidgets() {
  const [limitedKeys, setLimitedKeys] = useState<ReadonlySet<string>>(new Set());

  /** A card reports whether it ended on a limit; a repeat of what it said changes nothing. */
  const report = ({ key, limited }: { key: string; limited: boolean }) => {
    setLimitedKeys((previous) => {
      if (previous.has(key) === limited) return previous;
      const next = new Set(previous);
      if (limited) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  /** How many of the given widgets are on the board and ended on a limit. */
  const count = <W>({
    widgets,
    keyOf,
  }: {
    widgets: readonly W[];
    keyOf: (widget: W) => string;
  }): number => widgets.filter((widget) => limitedKeys.has(keyOf(widget))).length;

  return { report, count };
}
