/** One registered passkey, as the assertion check reads it. */
export type StoredPasskey = Readonly<{
  id: string;
  userId: string;
  /** base64url, as the authenticator names the credential. */
  credentialId: string;
  /** The COSE public key, standard base64 as Better Auth's passkey plugin stores it. */
  publicKey: string;
  counter: number;
  transports: readonly string[];
}>;

/** The `Passkey` rows Better Auth's plugin registers, read and advanced by auth alone. */
export abstract class PasskeyRepository {
  abstract findForUser(input: { userId: string }): Promise<StoredPasskey[]>;
  /** Every row naming this credential id, whoever holds it. */
  abstract findByCredentialId(input: { credentialId: string }): Promise<StoredPasskey[]>;
  /** Moves the signature counter forward; never backwards. */
  abstract advanceCounter(input: { id: string; counter: number }): Promise<void>;
}
