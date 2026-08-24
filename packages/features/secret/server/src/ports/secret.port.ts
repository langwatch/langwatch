export abstract class SecretEncryptionPort {
  abstract encrypt(value: string): string;
}
