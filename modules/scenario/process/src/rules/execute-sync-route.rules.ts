import type { ExecuteSyncRoute } from "@langwatch/scenario-contract";

/**
 * Where a child posts a code or workflow turn. Per-project engines need the credential that is the
 * tenant boundary, which never reaches the child, so it relays to the control plane at the address
 * the platform hands out as itself (never the CDN-fronted public host first); else direct.
 */
export function resolveExecuteSyncRoute({
  perProjectEngines,
  langwatchEndpoint,
  baseHost,
  nlpServiceUrl,
}: {
  perProjectEngines: boolean;
  langwatchEndpoint: string | undefined;
  baseHost: string;
  nlpServiceUrl: string;
}): ExecuteSyncRoute {
  if (perProjectEngines) {
    return { mode: "relay", relayBaseUrl: langwatchEndpoint || baseHost };
  }
  return { mode: "direct", nlpServiceUrl };
}
