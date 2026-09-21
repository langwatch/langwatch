// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { SsoConnectionSource } from "@langwatch/identity";
import { legacySsoDialOf } from "./legacy-sso-dial";

/**
 * WHICH method a sign-in sent to a connection would be dialed through, or null
 * when it would arrive nowhere (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * This is the seam where the two engines coexist, and it is deliberately a
 * module of its own rather than a closure in the composition root: what it
 * decides is the difference between an existing enterprise customer signing
 * in and being handed a password form, so it is a thing with a name that can
 * be tested without booting an application.
 *
 * Two ways to be dialable, both permanent:
 *
 *   the deployment's own    `NEXTAUTH_PROVIDER` mounts one provider through
 *                           better-auth's genericOAuth plugin. Every existing
 *                           enterprise customer signs in through it, brokered
 *                           SAML included, and nothing about that path is
 *                           narrowed or conditioned by D09. Which mounted
 *                           method carries an organization's legacy pin is
 *                           `legacySsoDialOf`, and the answer is the id.
 *   the organization's own  a provider the single sign-on plugin holds for
 *                           this connection, folded from the connection log.
 *                           The engine knows it by the CONNECTION id, so that
 *                           is what gets dialed.
 *
 * Checked in that order, and the order carries a promise: a connection the
 * mounted provider carries is dialable WITHOUT the engine's table being read
 * at all. So a deployment that has never registered anything per-organization
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

export function ssoMethodDialWith(
  ports: SsoMethodConfiguration,
): (args: {
  source: SsoConnectionSource;
  methodId: string;
  connectionId: string;
  organizationId: string;
}) => Promise<string | null> {
  return async ({ source, methodId, connectionId }) => {
    // The SOURCE decides which registry owns this connection, and it has to:
    // `providerId` is what the customer calls their provider, so two
    // organizations may both say `okta` and one of them may say the very name
    // this deployment mounts. Asking the mounted provider first, by that name,
    // let a self-serve connection the engine has never heard of answer
    // "dialable" purely because it borrowed the name.
    if (source === "legacy-grandfathered") {
      return legacySsoDialOf({
        pin: methodId,
        mountedMethodId: await ports.mountedMethodId(),
      });
    }
    return (await ports.engineHoldsProvider({ connectionId }))
      ? methodId
      : null;
  };
}
