/**
 * Which widgets on a board show no data, as each card's frame reports it, so the board can
 * offer Langy to set them up (dashboards-v2.feature AC13d).
 */

import { useState } from "react";

export function useEmptyWidgets() {
  const [emptyKeys, setEmptyKeys] = useState<ReadonlySet<string>>(new Set());

  /** A card reports whether it shows no data; a repeat of what it said changes nothing. */
  const report = ({ key, empty }: { key: string; empty: boolean }) => {
    setEmptyKeys((previous) => {
      if (previous.has(key) === empty) return previous;
      const next = new Set(previous);
      if (empty) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  /** The names of the given widgets that show no data, in board order. */
  const emptyNames = <W extends { name: string }>({
    widgets,
    keyOf,
  }: {
    widgets: readonly W[];
    keyOf: (widget: W) => string;
  }): string[] => widgets.filter((widget) => emptyKeys.has(keyOf(widget))).map(({ name }) => name);

  return { report, emptyNames };
}
