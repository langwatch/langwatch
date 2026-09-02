import type { SignInMethod, SignInMethodPolicy } from "@langwatch/identity-contract";
import type { SignInMethodPolicyPort } from "../signin-router.service";

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
 *
 * The four facts the policy is decided from are the DEPLOYMENT's, not this
 * package's: which provider it mounted, whether its licence carries
 * federation, whether it registered the passkey plugin, and whether it is the
 * hosted product. They used to be an `~/env.mjs` read and two calls into the
 * platform application's SSO gate; they arrive here as
 * {@link SignInMethodPolicyInputs} so the semantics above survive the move
 * unchanged while the reads stay where the values live.
 */

/**
 * What the deployment answers so the policy can be resolved.
 *
 * `resolveAuthProvider` is ADR-027's single source of truth and MUST be the
 * one that already coerces a denied or unmounted provider to `"email"` — the
 * policy trusts that coercion rather than repeating it, which is what keeps
 * "the licence denies SSO" and "the build never mounted the provider" landing
 * on the same email-mode answer.
 */
export interface SignInMethodPolicyInputs {
  /** `"email"`, or the federated provider id this deployment mounted. */
  resolveAuthProvider(): Promise<string>;
  /** Whether the licence carries federation. Memoized per process by its owner. */
  federationLicensed(): Promise<boolean>;
  /** Whether the passkey plugin was registered at boot. */
  offersPasskeys(): boolean;
  /** Whether this is a self-hosted deployment, which auto-redirects on its sole connection. */
  selfHosted(): boolean;
}

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
 * Whether this deployment mounted the passkey plugin at boot. The server half
 * is registered off the same value, so the set can never name a method the
 * endpoint behind it does not have.
 */
export function deploymentOffersPasskeys(passkeysEnabled: string | undefined): boolean {
  return passkeysEnabled === "on";
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
export function deploymentIsFederationCapable(authProvider: string | undefined): boolean {
  return authProvider !== "email";
}

/** The federated method this deployment offers, or null for email mode. */
export async function resolveFederatedMethod(
  resolveAuthProvider: () => Promise<string>,
): Promise<SignInMethod | null> {
  const provider = await resolveAuthProvider();
  return provider === "email" ? null : { id: provider, kind: "federated", connectionId: null };
}

/**
 * The policy the router routes on, and the hook enforces from. One resolution
 * per request; both gate reads inside it hit the same per-process memo.
 */
export async function resolveSignInMethodPolicy(
  inputs: SignInMethodPolicyInputs,
): Promise<SignInMethodPolicy> {
  const federationLicensed = await inputs.federationLicensed();
  const federated = await resolveFederatedMethod(inputs.resolveAuthProvider);
  // Offered alongside whatever else answers, never instead of it: somebody
  // without a passkey on THIS device must still find the way they used last
  // time. It is appended, so the order the screen renders does not move.
  const passkeys = inputs.offersPasskeys() ? [PASSKEY_METHOD] : [];
  return {
    defaultMethods: [...(federated ? [federated] : LOCAL_METHOD_SET), ...passkeys],
    localMethods: [...LOCAL_METHOD_SET, ...passkeys],
    federationLicensed,
    // Only a self-hosted deployment auto-redirects on its sole connection.
    selfHosted: inputs.selfHosted(),
  };
}

/** The policy port, over one deployment's four answers. */
export function signInMethodPolicyPortOver(
  inputs: SignInMethodPolicyInputs,
): SignInMethodPolicyPort {
  return { resolvePolicy: () => resolveSignInMethodPolicy(inputs) };
}
