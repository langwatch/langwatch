import type { Secret } from "@langwatch/secret-contract";

/**
 * One stored row's value, opened by the repository. A row the cipher refuses (another
 * key, or altered) carries why instead, so only a read that needs it fails.
 */
export type OpenedSecretValue =
  | Readonly<{ name: string; readable: true; value: string }>
  | Readonly<{ name: string; readable: false; reason: string }>;

export interface SecretProjectScope {
  readonly projectId: string;
}

export interface SecretIdentity {
  readonly projectId: string;
  readonly id: string;
}

export interface NamedSecretsScope {
  readonly projectId: string;
  readonly names: readonly string[];
}

export interface CreateStoredSecretInput {
  readonly projectId: string;
  readonly name: string;
  readonly value: string;
  readonly actorId: string;
}

export interface UpdateStoredSecretInput {
  readonly projectId: string;
  readonly id: string;
  readonly value: string;
  readonly actorId: string;
}

export interface SecretRepository {
  findAll(input: SecretProjectScope): Promise<Secret[]>;
  findAllValues(input: SecretProjectScope): Promise<OpenedSecretValue[]>;
  findValuesByName(input: NamedSecretsScope): Promise<OpenedSecretValue[]>;
  findById(input: SecretIdentity): Promise<Secret | undefined>;
  count(input: SecretProjectScope): Promise<number>;
  create(input: CreateStoredSecretInput): Promise<Secret>;
  update(input: UpdateStoredSecretInput): Promise<Secret>;
  delete(input: SecretIdentity): Promise<void>;
}
