import { configuredSocialProviderIds } from "@ee/sso/providers";
import { platformSSOAllowed, resolveAuthProvider } from "@ee/sso/sso-gate";
import type { SignInMethod, SignInMethodPolicy } from "@langwatch/identity";
import type { SignInMethodPolicyPort } from "@langwatch/identity-server";
import { env } from "~/env.mjs";
import { auth0BridgeActive, auth0BridgeRailIds } from "~/utils/auth0-bridge";
import {
  deploymentIssuesOwnPasswords,
  isEmailPasswordEnabled,
} from "../../better-auth/config/email-and-password";

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

/** The password door, where the deployment mounts one. */
export const LOCAL_METHOD_SET: readonly SignInMethod[] = [PASSWORD_METHOD];

/**
 * The instance's local method set — the break-glass and fallback door — as
 * this deployment ACTUALLY offers it.
 *
 * `LOCAL_METHOD_SET` is the shape of the door, not the answer to whether one
 * is hung. On SaaS the email/password routes mount only in native `email`
 * mode, so an instance brokering sign-in through another provider has no
 * local door at all — and every caller that used the constant as the answer
 * was told there was one. The distinction is the difference between "a
 * password would work here" and "a password works here", and break-glass is
 * the caller that cannot afford to confuse them: a grant against a door
 * nobody hung is a promise the deployment cannot keep.
 */
export function localSignInMethods(): readonly SignInMethod[] {
  return isEmailPasswordEnabled(env) ? LOCAL_METHOD_SET : [];
}

/**
 * Whether this deployment offers two-step verification at all (D06). The
 * two-factor plugin's server half is registered off this value, so a screen
 * that offers a setup can never call an endpoint nobody mounted.
 *
 * It is NOT part of any method set. Two-step verification is a second factor
 * answered after a first one, never a way in on its own, so nothing about it
 * belongs in `defaultMethods` or `localMethods`.
 */
export function deploymentOffersTwoStepVerification(): boolean {
  return env.MFA_ENROLLMENT_OPEN === "on";
}

/**
 * Whether this deployment offers passkeys at all (D07) — read here and by the
 * plugin list, so the method set and the endpoints behind it can never
 * disagree. A deployment where the button exists and the ceremony route does
 * not is the state the single switch exists to make unreachable.
 *
 * Default-on, which is the opposite way round from two-step verification and
 * deliberately so: passkeys are the shortest and strongest way in, and the
 * setting exists for the operator who must refuse them (a fleet with no
 * authenticators, a policy that only recognises the corporate identity
 * provider), not as a staged rollout. The schema defaults the value to `on`,
 * so anything that is not an explicit `off` offers them.
 *
 * Turning it off offers nothing and deletes nothing: the `Passkey` rows
 * survive, nobody is signed out, and turning it back on finds them all.
 */
export function deploymentOffersPasskeys(): boolean {
  return env.PASSKEYS_ENABLED !== "off";
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

const federatedMethod = (id: string): SignInMethod => ({
  id,
  kind: "federated",
  connectionId: null,
});

/**
 * The social identity providers this deployment offers, as methods.
 *
 * Which ones EXIST is `configuredSocialProviderIds`, read off what better-auth
 * was actually handed — so the door cannot offer Google to a deployment that
 * mounted no Google. Whether they may be offered AT ALL is ADR-027's gate,
 * applied here.
 *
 * ── Why the gate applies to social providers too ──────────────────────────
 *
 * better-auth's `socialProviders` map is built and passed at construction, so
 * the PLUGIN side is mounted without consulting the license; the gate is
 * enforced a layer up, by the request hook that refuses the SSO paths when it
 * denies (ADR-027 Decision 3). Read narrowly, "what better-auth mounts" would
 * therefore say these methods are ungated — and offering them here would put
 * a live-looking Google button on an unlicensed install whose very next hop
 * the hook refuses.
 *
 * ADR-027 Decision 2 settles it the other way, by name: "every non-email
 * provider is gated — `google`, `github`, `gitlab`, `azure-ad`, `okta`,
 * `auth0` … login federation is the paid feature". A social provider is not a
 * lesser class of federation that slips past the gate, and the conservative
 * reading is also the honest screen: a method nobody may complete is not
 * offered.
 */
function resolveSocialMethods({
  federationLicensed,
  federatedResolved,
}: {
  federationLicensed: boolean;
  /**
   * Whether the deployment's NAMED provider actually resolved
   * (`resolveFederatedMethod` answered a method rather than email mode).
   * The anchor that keeps stray credentials from overruling the landing: a
   * provider-name typo coerces to email mode, and offering a mounted social
   * anyway would put a federated method in `defaultMethods` — which is
   * exactly the predicate `refusesCredentialRoute` reads to 403 the
   * password and reset routes, locking every credential user out of a
   * deployment whose one misconfiguration was a typo.
   */
  federatedResolved: boolean;
}): readonly SignInMethod[] {
  if (!federationLicensed || !federatedResolved) return [];
  return configuredSocialProviderIds(env).map(federatedMethod);
}

/** The first occurrence of each method id, in the order given. Two sources
 *  can name the same provider — `NEXTAUTH_PROVIDER` and the mounted social
 *  map most obviously — and the rail must draw one button, not two. */
function dedupeById(methods: readonly SignInMethod[]): readonly SignInMethod[] {
  const seen = new Set<string>();
  const kept: SignInMethod[] = [];
  for (const method of methods) {
    if (seen.has(method.id)) continue;
    seen.add(method.id);
    kept.push(method);
  }
  return kept;
}

/**
 * The policy the router routes on, and the hook enforces from. One resolution
 * per request; both gate reads inside it hit the same per-process memo.
 */
export async function resolveSignInMethodPolicy(): Promise<SignInMethodPolicy> {
  // Resolved ONCE, and every branch below reads this answer rather than
  // asking the gate again. On the healthy path re-asking was free (the memo
  // answers); on the failure path it was not — the gate evicts its memo on
  // rejection (Decision 6, self-healing), so each extra await recomputed a
  // licensing scan behind its own timeout, and one unauthenticated request
  // held several slow database reads open exactly when the database was
  // already struggling.
  const federationLicensed = await platformSSOAllowed();
  // DENY is email mode by definition (ADR-027 Decision 2), which is also what
  // `resolveAuthProvider` would conclude — skipping it here spends no second
  // gate read to reach the same answer. When the gate allows, the memo is
  // warm and the call costs nothing.
  const federated = federationLicensed ? await resolveFederatedMethod() : null;
  const social = resolveSocialMethods({
    federationLicensed,
    federatedResolved: federated !== null,
  });
  // Offered alongside whatever else answers, never instead of it: somebody
  // without a passkey on THIS device must still find the way they used last
  // time. It is appended, so the order the screen renders does not move — and
  // omitted entirely where the operator turned passkeys off, because the
  // ceremony routes are not mounted there either.
  const passkeys = deploymentOffersPasskeys() ? [PASSKEY_METHOD] : [];
  // `NEXTAUTH_PROVIDER`'s method leads, because on every deployment that has
  // one it is THE way in and moving it would move the button people reach for.
  // The social set follows in rail order, less whatever it already named. With
  // neither, the local set is what is left — which is email mode, unchanged.
  //
  // The ONE exception is the Auth0 connection bridge (`utils/auth0-bridge.ts`):
  // on SaaS the branded buttons ARE the ways in — they dial the same broker,
  // pre-scoped to the connection its own screen would have offered — so they
  // stand ahead of the generic button, which stays for the sign-ins only
  // Auth0's screen can finish (its database users, enterprise connections).
  // The account lookup's subject routing is wired off the same
  // `auth0BridgeActive` predicate in `runtime.ts`; this site additionally
  // requires the RESOLVED method to be auth0, so an unmounted or unlicensed
  // broker offers no branded buttons — and then ranks nothing bridged either,
  // since ranking intersects with exactly this default set.
  //
  // A provider mounted NATIVELY takes its own bridge slot rather than landing
  // beside it (`auth0BridgeRailIds`): both ids mean "Continue with Google",
  // and a rail carrying them both would draw the same button twice, with
  // nothing on either to tell a person which one their account is behind.
  // Mounting the native client IS the cutover for that provider, one provider
  // at a time, and the slot keeps its leading position through it.
  const bridge =
    federated?.id === "auth0" &&
    auth0BridgeActive({
      isSaas: env.IS_SAAS,
      authProvider: env.NEXTAUTH_PROVIDER,
    })
      ? auth0BridgeRailIds({
          mountedSocialMethodIds: social.map((method) => method.id),
        }).map(federatedMethod)
      : [];
  const federatedMethods = dedupeById([
    ...bridge,
    ...(federated ? [federated] : []),
    ...social,
  ]);
  // The local set is what a deployment with no federated method falls back
  // to. A deployment that federates AND issues its own passwords (D09) offers
  // both — the federated methods still lead, because on a deployment that has
  // one it is THE way in, and the password stands behind them rather than
  // moving the button anybody reaches for.
  //
  // Without this the switch would be half-thrown: `user.register` would mint
  // a password account and `/sign-in/email` would accept it, while the door
  // offered no password to type and `rankAccountMethods` — which intersects
  // what an account holds with exactly this set — would drop the password of
  // everyone who had one.
  const local =
    federatedMethods.length === 0 || deploymentIssuesOwnPasswords(env)
      ? LOCAL_METHOD_SET
      : [];
  return {
    defaultMethods: [...federatedMethods, ...local, ...passkeys],
    // NOT the passkeys. Break-glass is the door somebody reaches for when the
    // identity provider cannot be answered, and the whole reason it exists is
    // that anybody can use it from any machine — which is exactly what a
    // credential bound to one device is not. `PASSKEY_METHOD` says so where it
    // is defined; this is the line that has to agree with it. Appending them
    // here was invisible while the plugin was behind a setting that defaulted
    // off, and would have gone live the moment it was not.
    localMethods: localSignInMethods(),
    federationLicensed,
    // Only a self-hosted deployment auto-redirects on its sole connection.
    selfHosted: !env.IS_SAAS,
  };
}

export const signInMethodPolicyPort: SignInMethodPolicyPort = {
  resolvePolicy: resolveSignInMethodPolicy,
};
