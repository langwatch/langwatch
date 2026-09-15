import type { Secret } from "@langwatch/secret-contract";

/**
 * One stored row's name and ciphertext. The only shape in this feature that
 * carries an encrypted value, and it never leaves the service that decrypts it.
 */
export interface StoredSecretValue {
  readonly name: string;
  readonly encryptedValue: string;
}

export interface SecretProjectScope {
  readonly projectId: string;
}

export interface SecretIdentity {
  readonly projectId: string;
  readonly id: string;
}

export interface CreateStoredSecretInput {
  readonly projectId: string;
  readonly name: string;
  readonly encryptedValue: string;
  readonly actorId: string;
}

export interface UpdateStoredSecretInput {
  readonly projectId: string;
  readonly id: string;
  readonly encryptedValue: string;
  readonly actorId: string;
}

export interface SecretRepository {
  findAll(input: SecretProjectScope): Promise<Secret[]>;
  findAllValues(input: SecretProjectScope): Promise<StoredSecretValue[]>;
  findById(input: SecretIdentity): Promise<Secret | undefined>;
  count(input: SecretProjectScope): Promise<number>;
  create(input: CreateStoredSecretInput): Promise<Secret>;
  update(input: UpdateStoredSecretInput): Promise<Secret>;
  delete(input: SecretIdentity): Promise<void>;
}
