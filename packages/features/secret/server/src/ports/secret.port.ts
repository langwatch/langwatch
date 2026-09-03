export abstract class SecretEncryptionPort {
  abstract encrypt(value: string): string;
  abstract decrypt(value: string): string;
}
