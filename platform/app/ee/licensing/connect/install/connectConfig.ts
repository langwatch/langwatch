/**
 * What the install side of Connect reads from its deployment configuration
 * (ADR-139).
 *
 * There is no switch that turns Connect on. What a deployment may call is
 * decided by the license it holds: a license that names a hosted service can
 * reach it, and a license that names none reaches nothing. An air-gapped
 * operator proves that from the license blob rather than from trusting a
 * variable, which is the only version of the claim that survives a security
 * review.
 *
 * `LANGWATCH_CONNECT_DISABLED` stays as the escape hatch an auditor asks for:
 * set it and this install builds no client and makes no outbound call, whatever
 * its license says.
 *
 * Read inside a function, never at module scope, so a process that boots
 * before its environment is resolved does not capture the wrong answer for its
 * whole life (ADR-093).
 */

import { env } from "~/env.mjs";

/** Where hosted services are called. */
export const CONNECT_DEFAULT_GATEWAY_ENDPOINT = "https://gateway.langwatch.ai";

/** Where a license registers itself and reads its own state. */
export const CONNECT_DEFAULT_LICENSE_ENDPOINT = "https://connect.langwatch.ai";

export interface ConnectConfig {
  /**
   * False only where an operator switched Connect off for this deployment.
   * True is not a claim that anything is reachable: the license decides that.
   */
  readonly permitted: boolean;
  readonly gatewayEndpoint: string;
  readonly licenseEndpoint: string;
  /**
   * The identity this install presents instead of the minted instance id. Set
   * only where an operator has a reason to name one.
   */
  readonly instanceIdOverride?: string;
}

export function readConnectConfig(): ConnectConfig {
  const instanceIdOverride = env.LANGWATCH_CONNECT_INSTANCE_ID?.trim();
  return {
    permitted: !env.LANGWATCH_CONNECT_DISABLED,
    gatewayEndpoint:
      env.LANGWATCH_CONNECT_GATEWAY_ENDPOINT ??
      CONNECT_DEFAULT_GATEWAY_ENDPOINT,
    licenseEndpoint:
      env.LANGWATCH_CONNECT_LICENSE_ENDPOINT ??
      CONNECT_DEFAULT_LICENSE_ENDPOINT,
    ...(instanceIdOverride ? { instanceIdOverride } : {}),
  };
}
