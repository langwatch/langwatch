import { platformSSOAllowed, resolveAuthProvider } from "@ee/sso/sso-gate";
import type { SignInMethod, SignInMethodPolicy } from "@langwatch/identity";
import type { SignInMethodPolicyPort } from "@langwatch/identity-server";
import { env } from "~/env.mjs";

/**
 * The instance's method-set policy (ADR-117 §4) — the module ADR-027's
 * mechanism moved INTO.
 *
 * ADR-027 gated SSO by blocking route paths, because under a single
 * `NEXTAUTH_PROVIDER` the provider set was fixed at boot and the `before` hook
 * was the only point that saw the legacy `/callback/auth0|okta` rewrite. Under
 * the router, *which methods exist at all* is policy, and this is where it
 * lives. Every semantic ADR-027 decided carries over unchanged:
 *
 *   - the gate is still `platformSSOAllowed()`, still THE one gate module,
 *     still memoized once per process. Policy is evaluated per request over a
 *     FROZEN gate value, which is what startup semantics means: nothing here
 *     re-decides a license, so activating one still takes a restart.
 *   - DENY is still email mode exactly: no federated method appears in the
 *     default set, so none can appear in a routing decision.
 *   - a provider the build never mounted still lands on email mode, via
 *     `resolveAuthProvider()`, which owns that coercion and its log line.
 *
 * `NEXTAUTH_PROVIDER` becomes the self-hosted default method set: one element,
 * offered automatically, which is byte-for-byte what a single-provider
 * deployment does today (ADR-117 §4). A second element can be added later
 * without ending the first — that is the whole change.
 */

/** The credential form. Local by definition: this deployment authenticates. */
export const PASSWORD_METHOD: SignInMethod = {
  id: "password",
  kind: "password",
  connectionId: null,
};

/**
 * A passkey. Local in the same sense the password is — this deployment
 * authenticates — but it is a way IN rather than a fallback, which is why it
 * is not in the break-glass set: the door that must stay open when the
 * identity provider cannot be reached is the one anybody can use from any
 * machine, and a passkey is bound to a device.
 */
export const PASSKEY_METHOD: SignInMethod = {
  id: "passkey",
  kind: "passkey",
  connectionId: null,
};

/** The instance's local method set — the break-glass and fallback door. */
export const LOCAL_METHOD_SET: readonly SignInMethod[] = [PASSWORD_METHOD];

/**
 * Whether this deployment offers two-step verification at all (D06). The
 * two-factor plugin's server half is registered off this value, so a screen
 * that offers a setup can never call an endpoint nobody mounted. Passkeys
 * used to have a matching read; they no longer do, because they are no longer
 * a setting — the plugin is mounted everywhere.
 *
 * It is NOT part of any method set. Two-step verification is a second factor
 * answered after a first one, never a way in on its own, so nothing about it
 * belongs in `defaultMethods` or `localMethods`.
 */
export function deploymentOffersTwoStepVerification(): boolean {
  return env.MFA_ENROLLMENT_OPEN === "on";
}

/**
 * Whether this deployment names a federated method AT ALL — a pure env read,
 * synchronous on purpose.
 *
 * The `before` hook has to answer this before it may await anything: a plain
 * email-mode deployment must never wait on the licensing store, and neither
 * must session traffic. Making the capability check async would put a store
 * read in front of `/get-session`, which is the availability failure ADR-027's
 * `isGateDependentPath` exists to avoid.
 */
export function deploymentIsFederationCapable(): boolean {
  return env.NEXTAUTH_PROVIDER !== "email";
}

/** The federated method this deployment offers, or null for email mode. */
export async function resolveFederatedMethod(): Promise<SignInMethod | null> {
  const provider = await resolveAuthProvider();
  return provider === "email"
    ? null
    : { id: provider, kind: "federated", connectionId: null };
}

/**
 * The policy the router routes on, and the hook enforces from. One resolution
 * per request; both gate reads inside it hit the same per-process memo.
 */
export async function resolveSignInMethodPolicy(): Promise<SignInMethodPolicy> {
  const federationLicensed = await platformSSOAllowed();
  const federated = await resolveFederatedMethod();
  // Offered alongside whatever else answers, never instead of it: somebody
  // without a passkey on THIS device must still find the way they used last
  // time. It is appended, so the order the screen renders does not move.
  const passkeys = [PASSKEY_METHOD];
  return {
    defaultMethods: [
      ...(federated ? [federated] : LOCAL_METHOD_SET),
      ...passkeys,
    ],
    // NOT the passkeys. Break-glass is the door somebody reaches for when the
    // identity provider cannot be answered, and the whole reason it exists is
    // that anybody can use it from any machine — which is exactly what a
    // credential bound to one device is not. `PASSKEY_METHOD` says so where it
    // is defined; this is the line that has to agree with it. Appending them
    // here was invisible while the plugin was behind a setting that defaulted
    // off, and would have gone live the moment it was not.
    localMethods: LOCAL_METHOD_SET,
    federationLicensed,
    // Only a self-hosted deployment auto-redirects on its sole connection.
    selfHosted: !env.IS_SAAS,
  };
}

export const signInMethodPolicyPort: SignInMethodPolicyPort = {
  resolvePolicy: resolveSignInMethodPolicy,
};
