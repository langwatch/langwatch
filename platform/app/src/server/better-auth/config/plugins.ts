import { passkey } from "@better-auth/passkey";
import { buildGenericOAuthConfigs } from "@ee/sso/providers";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { twoFactor } from "better-auth/plugins/two-factor";
import { env } from "~/env.mjs";
import type { PasskeySignUpRegistration } from "../passkey-signup";
import { passkeySignUpRegistration } from "../passkey-signup";
import { passkeyRelyingParty } from "../passkeyRelyingParty";
import type { ConfirmSignUpAddressContext } from "../sign-up-confirmation";
import { signUpConfirmation } from "../sign-up-confirmation";

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
  ];
}
