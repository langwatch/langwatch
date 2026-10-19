/**
 * The engine row's dialing configuration at rest (D09). It holds the client
 * secret the vault protects, so it is sealed where it is assembled and opened
 * at the one seam that dials with it — see sso-idp-termination.feature.
 */

/** What a sealed document begins with. Versioned so a second scheme can
 *  coexist with this one rather than replace it in place. */
const SSO_PROVIDER_CONFIG_SEAL = "enc:v1:";

/** Whether this stored document is sealed, or a plaintext row written before
 *  the seal existed. */
export function isSealedProviderConfig(stored: string): boolean {
  return stored.startsWith(SSO_PROVIDER_CONFIG_SEAL);
}

/**
 * Sealing and opening the engine row's configuration documents. Reading is
 * total over both forms, so no backfill is needed for it to be correct: a row
 * written before the seal existed is plaintext and comes back as it is.
 */
export interface SsoProviderConfigCipher {
  seal(document: string): string;
  open(stored: string): string;
}

/**
 * The deployment's cipher, over whatever already keeps its stored credentials
 * — one key to rotate rather than two against the same threat.
 */
export function sealedProviderConfigCipher(cipher: {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}): SsoProviderConfigCipher {
  return {
    seal: (document) => `${SSO_PROVIDER_CONFIG_SEAL}${cipher.encrypt(document)}`,
    open: (stored) =>
      isSealedProviderConfig(stored)
        ? cipher.decrypt(stored.slice(SSO_PROVIDER_CONFIG_SEAL.length))
        : stored,
  };
}
