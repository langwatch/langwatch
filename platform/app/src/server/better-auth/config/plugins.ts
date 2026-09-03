import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { buildGenericOAuthConfigs } from "@ee/sso/providers";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { env } from "~/env.mjs";
import type { PasskeySignUpRegistration } from "../passkey-signup";
import { passkeySignUpRegistration } from "../passkey-signup";
import { passkeyRelyingParty } from "../passkeyRelyingParty";
import type { ConfirmSignUpAddressContext } from "../sign-up-confirmation";
import { signUpConfirmation } from "../sign-up-confirmation";

/** Whether a customer's identity provider may assert this address. */
export interface SsoAssertionPort {
  decide(args: {
    providerId: string;
    email: string | null | undefined;
  }): Promise<{ action: "continue" } | { action: "reject"; code: string }>;
}

export interface PluginsDeps {
  /**
   * How many backup codes a set holds (D06).
   *
   * Stated rather than left to the plugin's default, because two things need
   * the same number and one of them is not the plugin: the `MfaEnrollment`
   * aggregate records HOW MANY codes a set holds, so "how many are left" is
   * answerable from the log without the log ever knowing a code. A default
   * that drifted would make that count a lie.
   */
  backupCodeCount: number;
  /** Creating an account WITH a passkey, rather than adding one to one. */
  passkeySignUp: () => PasskeySignUpRegistration;
  /** Spending the sign-up confirmation link, and opening a session with it. */
  confirmSignUpAddress: (ctx: ConfirmSignUpAddressContext) => Promise<unknown>;
  /** Whether an assertion may become a session, and may link to an account. */
  ssoAssertion: () => SsoAssertionPort;
}

/**
 * The plugins this deployment mounts, in the order it mounts them.
 *
 * NOTE: BetterAuth's admin plugin is intentionally NOT used. It expects
 * `User.role` and `User.banned` columns which our schema doesn't have, and
 * it would override admin impersonation with its own mechanism. We use our
 * own `isAdmin` check (ee/admin/isAdmin.ts) and the session's own
 * `{actor, subject}` impersonation claims, read in src/server/auth.ts (D06 —
 * they replaced the legacy `Session.impersonating` JSON column).
 *
 * D06 / D07. The env flags below are read when this is called, which is when
 * `betterAuth()` is constructed, because a plugin decides which ROUTES exist.
 * With a flag off the plugin is not registered at all, so its routes are not
 * mounted and nothing about the feature is reachable — which is what makes
 * "with the flag off nothing about it exists" true of the surface rather than
 * merely of the screens.
 *
 * Turning a flag back off is not a deletion. `TwoFactor` and `Passkey` rows
 * survive it and nobody is signed out; the feature stops being ASKED for,
 * and turning it on again finds everything where it was.
 *
 * Env rather than a feature flag for both: a challenge stands between a
 * password and a session, and registering a passkey happens on the sign-in
 * screen. Feature flags are read per project, and neither caller has one yet.
 */
export function plugins({
  backupCodeCount,
  passkeySignUp,
  confirmSignUpAddress,
  ssoAssertion,
}: PluginsDeps) {
  const genericOAuthConfigs = buildGenericOAuthConfigs(env);
  const mfaEnrollmentOpen = env.MFA_ENROLLMENT_OPEN === "on";

  return [
    ...(genericOAuthConfigs.length > 0
      ? [genericOAuth({ config: genericOAuthConfigs })]
      : []),
    ...(mfaEnrollmentOpen
      ? [
          twoFactor({
            issuer: "LangWatch",
            // An account with NO password can still turn two-step verification
            // on, off, and draw fresh backup codes.
            //
            // The plugin's default demands a password on all three, which made
            // the feature unreachable for exactly the accounts we most want
            // enrolled: somebody who signed up with a passkey has no password
            // to type, and the setup dialog asked for one anyway. This is the
            // plugin's own sanctioned switch, not a fork of it —
            // `shouldRequirePassword` still demands the password from every
            // account that HAS one, and only waives it where the credential row
            // holds none. The session is still required; what changes is the
            // second proof, which for a passwordless account was impossible
            // rather than optional.
            allowPasswordless: true,
            // Encrypted, not hashed. A backup code has to be COMPARED against
            // what the person types, and the plugin's own verification path
            // decrypts and compares; hashing them would make the plugin
            // unable to verify its own codes. `NEXTAUTH_SECRET` is the key,
            // which is why turning the flag on without one set is refused at
            // boot by the env schema rather than at first use.
            backupCodeOptions: {
              storeBackupCodes: "encrypted",
              amount: backupCodeCount,
            },
          }),
        ]
      : []),
    ...[
      passkey({
        rpName: "LangWatch",
        // The relying party is the address a BROWSER reaches this deployment
        // on, which behind a reverse proxy is not `baseURL`. The plugin's own
        // default derives it from `baseURL` — our internal address — and a
        // preview host then builds every ceremony for the relying party
        // "localhost" while the browser signs for the public one, so every
        // passkey is refused as unrecognized. See `passkeyRelyingParty.ts`.
        // Null when the deployment names neither address, and the plugin keeps
        // its own default there rather than the boot failing.
        ...(passkeyRelyingParty({
          baseHost: env.BASE_HOST,
          nextAuthUrl: env.NEXTAUTH_URL,
        }) ?? {}),

        // Signing UP with a passkey, not only adding one to an account that
        // already exists. This is what drops the session requirement from
        // the two registration endpoints — see `passkey-signup.ts` for what
        // stands in its place, and why an address that already has an
        // account must be refused there.
        registration: passkeySignUpRegistration({ signUp: passkeySignUp }),
      }),
    ],
    // The sign-up confirmation link, spent where a session can be opened for
    // it. See `sign-up-confirmation.ts` for why this is not a tRPC procedure.
    signUpConfirmation({ confirmSignUpAddress }),
    /**
     * Per-organization single sign-on (D09 — see
     * specs/identity/sso-idp-termination.feature).
     *
     * Mounted BESIDE `genericOAuth`, never instead of it. The deployment's own
     * provider — `NEXTAUTH_PROVIDER`, which is what every existing enterprise
     * customer signs in through, Auth0-brokered SAML included — keeps its
     * routes, its accounts and its behavior exactly as they were. This plugin
     * adds a second way for a sign-in to arrive, keyed per connection, and the
     * two coexist for as long as anybody is using either.
     *
     * Unconditional rather than flag-gated, and the two are different things.
     * What the plugin being registered does is mount routes that answer for
     * providers in a table; with no rows, `/sso/*` answers "no such provider"
     * and nothing about anybody's sign-in changes. What decides whether a
     * sign-in ROUTES to a connection is whether that connection is live, and
     * that decision is the router's rather than the engine's.
     *
     * The provider rows themselves are never written through this plugin's own
     * registration endpoint. They are folded from the connection log
     * (`sso-connection-projection.prisma.repository.ts`), which is what keeps
     * the aggregate the only source of truth and makes the engine's table
     * rebuildable by replay.
     */
    sso({
      // The identity provider's word on whether it verified the address.
      //
      // This is what lets an organization move from the brokered provider to
      // its own without minting a second account for everybody: the subject an
      // identity provider asserts natively is not the subject Auth0 brokered
      // (`samlp|...`), so the new account can only find the existing person by
      // ADDRESS. better-auth links on a verified address and refuses on an
      // unverified one, and without this the plugin reports every address as
      // unverified — so every cutover would be a fresh set of duplicates.
      //
      // Trusting it is warranted here in a way it would not be for a public
      // provider: the domain is DNS-proved before the connection may route, and
      // the assertion comes from the identity provider that domain named. The
      // local half of the check is untouched — better-auth still refuses to
      // link into a LangWatch account whose own address was never verified.
      trustEmailVerified: true,
      // Somebody with no LangWatch account who signs in through their
      // employer's provider gets one, which is what an enterprise rollout
      // means. Whether they then land in the organization is the connection's
      // the arrival policy and the join policy's business, not this plugin's.
      disableImplicitSignUp: false,
      /**
       * What makes trusting the flag above defensible.
       *
       * `trustEmailVerified` hands the decision "is this address real" to the
       * customer's own identity provider, and better-auth will link a verified
       * address onto an existing account. On its own that is an account
       * takeover: register a connection, point it at a server you control,
       * assert somebody else's address. The comment above this option claims
       * "the domain is DNS-proved before the connection may route" — this hook
       * is what makes that sentence true, because nothing else on the link path
       * ever looked at the connection's proved domains.
       *
       * The only pre-link callback the plugin offers, which is why the check
       * lives here and not in a database hook.
       */
      resolveUser: async (input) =>
        ssoAssertion().decide({
          providerId: input.providerId,
          email: input.providerUser.email,
        }),
    }),
  ];
}
