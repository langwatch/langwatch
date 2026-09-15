/**
 * The engine row's dialing configuration, kept at rest the way every other
 * credential in the product is (D09 — see
 * specs/identity/sso-idp-termination.feature).
 *
 * WHY THIS EXISTS. `SsoConnection`'s facts carry references, never values, and
 * `SsoCredential` keeps the values encrypted under the deployment's own
 * secret. The engine row is derived from both — and the derivation used to
 * decrypt the client secret out of the vault and write it back in cleartext,
 * because the sign-in engine needs a configuration document it can read
 * synchronously. That handed anybody with a database copy every customer's
 * live identity-provider credential, which is the exact threat the vault was
 * built to defeat. The document is sealed now, and opened at the one seam
 * that reads it.
 *
 * A MARKER RATHER THAN A COLUMN. The stored string says which form it is in,
 * so a row written before this existed still opens — the same shape
 * `ScimToken.hashScheme` uses for the same reason. Reading is therefore
 * total: a legacy plaintext document is returned unchanged, and only a
 * document that announces itself as sealed is ever put through the cipher.
 *
 * ORDER OF DEPLOY. The reader tolerates both forms, so a pod carrying this
 * change reads every row that exists. A pod that does NOT carry it cannot
 * read a sealed one — so this must not be rolled back past, and a rollout
 * that re-folds a connection mid-deploy can leave the previous release
 * unable to dial that one connection until it finishes.
 */

/** What a sealed document begins with. Versioned so a second scheme can
 *  coexist with this one rather than replace it in place. */
export const SSO_PROVIDER_CONFIG_SEAL = "enc:v1:";

/** Whether this stored document is sealed, or a plaintext row written before
 *  the seal existed. */
export const isSealedProviderConfig = (stored: string): boolean =>
  stored.startsWith(SSO_PROVIDER_CONFIG_SEAL);

/**
 * Sealing and opening the engine row's configuration documents.
 *
 * A port rather than a direct import: the cipher is the app's
 * (`~/utils/encryption`, AES-256-GCM under `CREDENTIALS_SECRET`), and this
 * package must not reach into it — the same separation `SsoCredentialStore`
 * already draws between the reference and the vault behind it.
 */
export interface SsoProviderConfigCipher {
  /** Plaintext document in, sealed document out. */
  seal(document: string): string;
  /**
   * Stored document in, plaintext out. Total over both forms: an unsealed
   * document is returned as it was, so this can be called on every row
   * without asking which form it is in first.
   */
  open(stored: string): string;
}

/**
 * The cipher for a deployment that has none — used where the engine row is
 * built for inspection rather than for dialing, and by tests that care about
 * the derivation rather than about what it is kept under.
 *
 * Named for what it does. A default that quietly wrote cleartext under a
 * reassuring name is how the original defect read as finished.
 */
export const plaintextProviderConfigCipher: SsoProviderConfigCipher = {
  seal: (document) => document,
  open: (stored) =>
    isSealedProviderConfig(stored)
      ? // A sealed document with no cipher to open it is not something to
        // guess at: returning the ciphertext would hand the engine a string
        // it would try to parse as a configuration.
        (() => {
          throw new Error(
            "sso provider config is sealed but no cipher was supplied",
          );
        })()
      : stored,
};
