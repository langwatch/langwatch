import type { LangyServerConfig } from "@langwatch/langy-contract";

/** The addresses a turn hands the worker, in main's order of precedence. */
export function langyWorkerRuntimeOf({
  config,
  publicBaseUrl,
}: {
  config: LangyServerConfig;
  publicBaseUrl: string | undefined;
}): {
  workerCallbackUrl: string | undefined;
  workerGatewayBaseUrl: string | undefined;
  mirrorProjectId: string | undefined;
} {
  return {
    workerCallbackUrl: config.workerCallbackUrl ?? publicBaseUrl,
    workerGatewayBaseUrl:
      config.workerGatewayUrl ??
      config.gatewayInternalUrl ??
      config.gatewayPublicUrl ??
      config.gatewayLegacyUrl,
    mirrorProjectId: config.mirrorProjectId,
  };
}

/** How the worker takes a turn: revive a parked one, create a session, or continue the live one. */
export function langyDispatchIntentOf({
  resumable,
  hasApiKey,
}: {
  resumable: boolean;
  hasApiKey: boolean;
}): "create" | "revive" | "continue" {
  if (resumable) return "revive";
  return hasApiKey ? "create" : "continue";
}
