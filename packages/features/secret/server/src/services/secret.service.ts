import {
  createSecretInputSchema,
  deleteSecretInputSchema,
  getSecretInputSchema,
  listSecretsInputSchema,
  MAX_SECRETS_PER_PROJECT,
  SecretLimitReachedError,
  SecretNotFoundError,
  SecretReservedNameError,
  SecretService as SecretServiceContract,
  updateSecretInputSchema,
  type CreateSecretInput,
  type DeleteSecretInput,
  type GetSecretInput,
  type ListSecretsInput,
  type Secret,
  type UpdateSecretInput,
} from "@langwatch/secret-contract";
import type { SecretEncryptionPort } from "../ports/secret.port";
import type { SecretRepository } from "../repositories/secret.repository";

export interface SecretServiceOptions {
  repository: SecretRepository;
  encryption: SecretEncryptionPort;
  reservedNames: readonly string[];
  maximumPerProject?: number;
}

export class SecretService extends SecretServiceContract {
  private readonly reservedNames: ReadonlySet<string>;
  private readonly maximumPerProject: number;

  private constructor(private readonly options: SecretServiceOptions) {
    super();
    this.reservedNames = new Set(options.reservedNames);
    this.maximumPerProject = options.maximumPerProject ?? MAX_SECRETS_PER_PROJECT;
  }

  static create(options: SecretServiceOptions): SecretService {
    return new SecretService(options);
  }

  async list(input: ListSecretsInput): Promise<Secret[]> {
    const parsed = listSecretsInputSchema.parse(input);
    const rows = await this.options.repository.list(parsed.projectId);
    return rows.filter((secret) => !this.reservedNames.has(secret.name));
  }

  async getValues(input: ListSecretsInput): Promise<Record<string, string>> {
    const parsed = listSecretsInputSchema.parse(input);
    const rows = await this.options.repository.listEncryptedValues(parsed.projectId);
    const values: Record<string, string> = {};

    for (const row of rows) {
      try {
        values[row.name] = this.options.encryption.decrypt(row.encryptedValue);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to decrypt project secret "${row.name}": ${message}`);
      }
    }

    return values;
  }

  async get(input: GetSecretInput): Promise<Secret> {
    const parsed = getSecretInputSchema.parse(input);
    return this.getMutableSecret(parsed);
  }

  async create(input: CreateSecretInput): Promise<Secret> {
    const parsed = createSecretInputSchema.parse(input);
    if (this.reservedNames.has(parsed.name)) {
      throw new SecretReservedNameError(parsed.name);
    }
    if (
      (await this.options.repository.count(parsed.projectId)) >= this.maximumPerProject
    ) {
      throw new SecretLimitReachedError(this.maximumPerProject);
    }
    return this.options.repository.create({
      projectId: parsed.projectId,
      name: parsed.name,
      encryptedValue: this.options.encryption.encrypt(parsed.value),
      actorId: parsed.actorId,
    });
  }

  async update(input: UpdateSecretInput): Promise<Secret> {
    const parsed = updateSecretInputSchema.parse(input);
    await this.getMutableSecret(parsed);
    return this.options.repository.update({
      projectId: parsed.projectId,
      id: parsed.id,
      encryptedValue: this.options.encryption.encrypt(parsed.value),
      actorId: parsed.actorId,
    });
  }

  async delete(input: DeleteSecretInput): Promise<void> {
    const parsed = deleteSecretInputSchema.parse(input);
    await this.getMutableSecret(parsed);
    await this.options.repository.delete(parsed.projectId, parsed.id);
  }

  private async getMutableSecret(input: {
    projectId: string;
    id: string;
  }): Promise<Secret> {
    const secret = await this.options.repository.get(input.projectId, input.id);
    if (this.reservedNames.has(secret.name)) {
      throw new SecretNotFoundError();
    }
    return secret;
  }
}
