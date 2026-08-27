import {
  isSealedProviderConfig,
  SSO_PROVIDER_CONFIG_SEAL,
  type SsoProviderConfigCipher,
} from "@langwatch/identity-server";
import { decrypt, encrypt } from "~/utils/encryption";

/**
 * The deployment's cipher for the engine row's dialing document (D09).
 *
 * `~/utils/encryption` and nothing of its own: AES-256-GCM keyed by
 * `CREDENTIALS_SECRET`, which is what `SsoCredential` and every other stored
 * credential in the product already sit under. The document this seals holds
 * the client secret that vault protects, so keeping it under a second scheme
 * would mean a second key to rotate and a second thing to get wrong.
 */
export const ssoProviderConfigCipher: SsoProviderConfigCipher = {
  seal: (document) => `${SSO_PROVIDER_CONFIG_SEAL}${encrypt(document)}`,

  /**
   * Total over both forms, so no backfill is needed for this to be correct:
   * a row written before the seal existed is plaintext and is returned as it
   * is, and only a document announcing itself as sealed is decrypted.
   */
  open: (stored) =>
    isSealedProviderConfig(stored)
      ? decrypt(stored.slice(SSO_PROVIDER_CONFIG_SEAL.length))
      : stored,
};
