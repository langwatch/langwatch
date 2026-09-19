/**
 * What the install side of Connect reads from its deployment configuration
 * (ADR-139).
 *
 * Off unless an operator switched it on, and off is the whole of the upgrade
 * guarantee: an install that sets none of these variables builds no client,
 * resolves no credential and makes no outbound call.
 *
 * Read inside a function, never at module scope, so a process that boots
 * before its environment is resolved does not capture the wrong answer for its
 * whole life (ADR-093).
 */

import { env } from "~/env.mjs";

/** Where hosted services are called. */
export const CONNECT_DEFAULT_GATEWAY_ENDPOINT = "https://gateway.langwatch.ai";

/** Where a license registers itself and reads its own state (M5). */
export const CONNECT_DEFAULT_LICENSE_ENDPOINT = "https://connect.langwatch.ai";

export interface ConnectConfigOn {
  readonly enabled: true;
  readonly gatewayEndpoint: string;
  readonly licenseEndpoint: string;
  /**
   * The identity this install presents instead of the organization id. Set
   * only where an operator has a reason to name one.
   */
  readonly instanceIdOverride?: string;
}

export type ConnectConfig = { readonly enabled: false } | ConnectConfigOn;

export function readConnectConfig(): ConnectConfig {
  if (!env.LANGWATCH_CONNECT_ENABLED) return { enabled: false };

  const instanceIdOverride = env.LANGWATCH_CONNECT_INSTANCE_ID?.trim();
  return {
    enabled: true,
    gatewayEndpoint:
      env.LANGWATCH_CONNECT_GATEWAY_ENDPOINT ??
      CONNECT_DEFAULT_GATEWAY_ENDPOINT,
    licenseEndpoint:
      env.LANGWATCH_CONNECT_LICENSE_ENDPOINT ??
      CONNECT_DEFAULT_LICENSE_ENDPOINT,
    ...(instanceIdOverride ? { instanceIdOverride } : {}),
  };
}
