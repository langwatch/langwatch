// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SsoConnectionSource } from "@langwatch/identity";

/**
 * Whether a sign-in sent to a connection would ARRIVE anywhere (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * This is the seam where the two engines coexist, and it is deliberately a
 * module of its own rather than a closure in the composition root: what it
 * decides is the difference between an existing enterprise customer signing
 * in and being handed a password form, so it is a thing with a name that can
 * be tested without booting an application.
 *
 * Two ways to be configured, both permanent:
 *
 *   the deployment's own    `NEXTAUTH_PROVIDER` mounts one provider through
 *                           better-auth's genericOAuth plugin. Every existing
 *                           enterprise customer signs in through it, brokered
 *                           SAML included, and nothing about that path is
 *                           narrowed or conditioned by D09.
 *   the organization's own  a provider the single sign-on plugin holds for
 *                           this connection, folded from the connection log.
 *
 * Checked in that order, and the order carries a promise: a connection naming
 * the mounted provider is configured WITHOUT the engine's table being read at
 * all. So a deployment that has never registered anything per-organization
 * answers exactly what it answered before this function existed, and it does
 * it without a database round trip on the sign-in path.
 */
export interface SsoMethodConfiguration {
  /** The provider this deployment mounts from its environment, or null in
   *  plain email mode. */
  mountedMethodId(): Promise<string | null>;
  /** Whether the engine holds a provider registered for this connection. */
  engineHoldsProvider(args: { connectionId: string }): Promise<boolean>;
}

export function ssoMethodIsConfiguredWith(
  ports: SsoMethodConfiguration,
): (args: {
  source: SsoConnectionSource;
  methodId: string;
  connectionId: string;
  organizationId: string;
}) => Promise<boolean> {
  return async ({ source, methodId, connectionId }) => {
    // The SOURCE decides which registry owns this connection, and it has to:
    // `providerId` is what the customer calls their provider, so two
    // organizations may both say `okta` and one of them may say the very name
    // this deployment mounts. Asking the mounted provider first, by that name,
    // let a self-serve connection the engine has never heard of answer
    // "configured" purely because it borrowed the name.
    if (source === "legacy-grandfathered") {
      return (await ports.mountedMethodId()) === methodId;
    }
    return ports.engineHoldsProvider({ connectionId });
  };
}
