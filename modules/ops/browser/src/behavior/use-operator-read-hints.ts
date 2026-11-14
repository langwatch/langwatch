/**
 * An Ops read refetched on presence's operator hint (ADR-202 Decided 14): the shell opens no hint
 * stream on a tab with no organisation in scope, so the read's own screen listens. No timer polls.
 * Spec: modules/ops/specs/event-log-search.feature
 */
import { procedurePathOf } from "@langwatch/browser-host/cache-tiers";
import { useUiRpc } from "@langwatch/browser-host/capabilities";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

/** presence's platform stream of the operator's own user-scope hints. */
export const OPERATOR_READ_HINTS_PROCEDURE = "presence.onOperatorReadHints";

const isHintFor = (hint: unknown, path: string) =>
  typeof hint === "object" && hint !== null && "path" in hint && hint.path === path;

/** Re-reads every mounted query at `path` when a hint for that path arrives. */
export function useOperatorReadHints({ path }: { path: string }): void {
  const rpc = useUiRpc();
  const queryClient = useQueryClient();

  useEffect(() => {
    const onData = (hint: unknown) => {
      if (!isHintFor(hint, path)) return;
      void queryClient.invalidateQueries({
        predicate: (query) => procedurePathOf(query.queryKey) === path,
      });
    };
    // Hints are optional: a runtime with no stream leaves the read as last answered.
    try {
      const subscription = rpc.subscribe(OPERATOR_READ_HINTS_PROCEDURE, undefined, { onData });
      return () => subscription.unsubscribe();
    } catch {
      return;
    }
  }, [rpc, queryClient, path]);
}
