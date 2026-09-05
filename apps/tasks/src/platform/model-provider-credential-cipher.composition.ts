import { AesGcmSecretEncryptionAdapter } from "@langwatch/secret-server";
import { ModelProviderCredentialCipherPort } from "@langwatch/model-provider-server";

/** The deployment's stored-secret cipher, as the ModelProvider rows want it. */
class AesGcmModelProviderCredentialCipher extends ModelProviderCredentialCipherPort {
  constructor(private readonly encryption: AesGcmSecretEncryptionAdapter) {
    super();
  }

  encrypt(value: string): string {
    return this.encryption.encrypt(value);
  }

  decrypt(value: string): string {
    return this.encryption.decrypt(value);
  }
}

/**
 * Builds the cipher from the deployment's `CREDENTIALS_SECRET`, or throws —
 * the credential migration writes ciphertext every other process has to
 * read, so a deployment with no key configured must not run it.
 */
export function modelProviderCredentialCipherFromEnv({
  key,
}: {
  key: string | undefined;
}): ModelProviderCredentialCipherPort {
  const trimmed = key?.trim();
  if (!trimmed) {
    throw new Error(
      "The credential migration writes ciphertext every other process has to read: set CREDENTIALS_SECRET.",
    );
  }
  return new AesGcmModelProviderCredentialCipher(
    AesGcmSecretEncryptionAdapter.create({ key: trimmed }),
  );
}
