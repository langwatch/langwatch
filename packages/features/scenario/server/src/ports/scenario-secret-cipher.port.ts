/** Encrypts the opaque secret values that travel with a queued scenario run. */
export abstract class ScenarioSecretCipherPort {
  abstract encrypt(plaintext: string): string;

  abstract decrypt(ciphertext: string): string;
}
