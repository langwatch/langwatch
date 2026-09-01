/**
 * An overlay that lives in the address, and nothing that registers one.
 *
 * `platform/app` mounted every Ops drawer through `components/drawerRegistry.ts`
 * and opened it by name — `openDrawer("opsGroupDetail", { queueName, groupId })`
 * — which is a composition the application owns and a feature-web package may
 * not carry a copy of. What the surfaces ever needed from it was the ADDRESS:
 * an operator who has a queue group open must be able to send that URL to
 * whoever is on call with them.
 *
 * So each overlay keeps its own query key, the surface that opens it also
 * renders it, and the registry entry is deleted. This is the answer the gateway
 * family reached for its routing-policy editor (`?policy=<id>`) and the
 * automations family for both of its drawers, and it is the third time it has
 * been the right one.
 *
 * `setQuery` REPLACES the whole query string, so `open` spreads what is already
 * there: an overlay opened over a filtered table must not clear the filter.
 */

import { useCallback, useMemo } from "react";
import { useOpsHost } from "../model/ops-host";

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
