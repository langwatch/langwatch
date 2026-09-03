export abstract class GovernanceEncryptionPort {
  abstract encrypt(plaintext: string): string;
  abstract decrypt(ciphertext: string): string;
}
