/**
 * The Upgrades pages' live refresh (round 8, U2-LIVE): the runner's read hint, relayed by
 * presence to operators, re-reads every mounted `ops.upgrade.*` query. No timer polls.
 * Spec: modules/ops/specs/upgrades.feature
 */
import { procedurePathOf } from "@langwatch/browser-host/cache-tiers";
import { useUiRpc } from "@langwatch/browser-host/capabilities";
import { type Query, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** presence's platform stream; the path string is the shell's own spelling (query-hints.ts). */
export const UPGRADE_READ_HINTS_PROCEDURE = "presence.onUpgradeReadHints";

const UPGRADE_READS = "ops.upgrade.";

const isUpgradeRead = (query: Query) =>
  procedurePathOf(query.queryKey)?.startsWith(UPGRADE_READS) ?? false;

export function useUpgradeReadHints(): void {
  const rpc = useUiRpc();
  const queryClient = useQueryClient();

  useEffect(() => {
    const onData = () => void queryClient.invalidateQueries({ predicate: isUpgradeRead });
    // Hints are optional: a runtime with no stream leaves the page as last read.
    try {
      const subscription = rpc.subscribe(UPGRADE_READ_HINTS_PROCEDURE, undefined, { onData });
      return () => subscription.unsubscribe();
    } catch {
      return;
    }
  }, [rpc, queryClient]);
}
