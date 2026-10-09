import { useTraceHost } from "../trace-host.ts";

/**
 * "May this reader START a conversation?" — the other half of Langy's permission pair.
 * Spec: specs/home/langy-home.feature
 */
export function useCanAskLangy(): boolean {
  const traceHost = useTraceHost();
  return traceHost.hasPermission("langy:create");
}
