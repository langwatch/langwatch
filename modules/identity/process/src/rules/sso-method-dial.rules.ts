import type { SsoConnectionSource } from "@langwatch/identity-contract";

import { legacySsoDialOf } from "./legacy-sso-dial.rules.ts";

/** Where each half of the answer comes from, supplied rather than read here
 *  so the decision below needs neither a deployment nor an engine. */
export interface SsoMethodConfiguration {
  /** The providers this deployment mounts from its own configuration. Empty
   *  in plain email mode; one of them otherwise. */
  mountedMethods(): Promise<readonly string[]>;
  /** Whether the engine holds a provider registered for this connection. */
  engineHoldsProvider(args: { connectionId: string }): Promise<boolean>;
}

/** The connection a sign-in would be sent to, as dialing sees it. */
export interface SsoMethodDialRequest {
  source: SsoConnectionSource;
  /** The grandfathered pin, or the connection id a registration is keyed by. */
  methodId: string;
  connectionId: string;
}

/** WHICH method a sign-in sent to this connection is dialed through, or null
 *  when it would arrive nowhere. */
export type SsoMethodDial = (request: SsoMethodDialRequest) => Promise<string | null>;

/**
 * The seam where the two engines coexist (D09): the provider this deployment
 * mounts, and one the engine holds for a single connection. The SOURCE picks
 * the registry - two organizations may both call their provider `okta`.
 */
export function ssoMethodDialWith(configuration: SsoMethodConfiguration): SsoMethodDial {
  return async ({ source, methodId, connectionId }) => {
    if (source === "legacy-grandfathered") {
      const [mounted] = await configuration.mountedMethods();
      const dial = legacySsoDialOf({ pin: methodId, mountedMethodId: mounted ?? null });

      return dial.dialable ? dial.methodId : null;
    }

    return (await configuration.engineHoldsProvider({ connectionId })) ? methodId : null;
  };
}
