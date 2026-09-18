/** Query-keyed overlays (not registry); setQuery replaces whole string to preserve
 * filters when opening over a filtered view. */

import { useCallback, useMemo } from "react";

import { useOpsHost } from "../model/ops-host.ts";

export type OpsOverlay = {
  /** The value the address carries for this overlay, or null when it is shut. */
  value: string | null;
  open: (value: string) => void;
  close: () => void;
};

export function useOpsOverlay(key: string): OpsOverlay {
  const host = useOpsHost();
  const reading = host.route();
  const value = reading.query[key] ?? null;

  const open = useCallback(
    (next: string) => {
      host.setQuery({ ...reading.query, [key]: next });
    },
    [host, reading, key],
  );

  const close = useCallback(() => {
    host.setQuery({ ...reading.query, [key]: void 0 });
  }, [host, reading, key]);

  return useMemo(() => ({ value, open, close }), [value, open, close]);
}

/** The separator a composite overlay address uses. A queue name has no pipe in it. */
export const OPS_OVERLAY_SEPARATOR = "|";

/** Splits a composite overlay address, refusing anything with the wrong arity. */
export function readOverlayParts(value: string | null, arity: number): string[] | null {
  if (value === null) return null;
  const parts = value.split(OPS_OVERLAY_SEPARATOR);
  return parts.length === arity && parts.every((part) => part.length > 0) ? parts : null;
}
