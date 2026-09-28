import { AuthenticatedActorRequiredError } from "@langwatch/api";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import {
  listSecretsInputSchema,
  MAX_SECRETS_PER_PROJECT,
  SecretDuplicateError,
  SecretLimitReachedError,
  SecretNotFoundError,
  SecretReservedNameError,
  type CreateReservedSecretInput,
  type CreateSecretInput,
  type DeleteSecretInput,
  type GetSecretInput,
  type ListSecretsInput,
  type Secret,
  type SecretCaller,
  type UpdateSecretInput,
} from "@langwatch/secret-contract";

import type { SecretEncryption } from "../app/secret.app.ts";
import type { SecretRepository } from "../repositories/secret.repository.ts";

export interface SecretServiceOptions {
  repository: SecretRepository;
  encryption: SecretEncryption;
  reservedNames: readonly string[];
  maximumPerProject?: number;
  projects: Pick<ProjectApi, "getWithTeam">;
  permissions: Pick<AuthzApi, "listTeamMemberBindings">;
}

export class SecretService {
  private readonly reservedNames: ReadonlySet<string>;
  private readonly maximumPerProject: number;

  private constructor(private readonly options: SecretServiceOptions) {
    this.reservedNames = new Set(options.reservedNames);
    this.maximumPerProject = options.maximumPerProject ?? MAX_SECRETS_PER_PROJECT;
  }

  static create(options: SecretServiceOptions): SecretService {
    return new SecretService(options);
  }

  async list(input: ListSecretsInput): Promise<Secret[]> {
    const rows = await this.options.repository.findAll({ projectId: input.projectId });

    return rows.filter((secret) => !this.reservedNames.has(secret.name));
  }

  async getValues(input: ListSecretsInput): Promise<Record<string, string>> {
    const parsed = listSecretsInputSchema.parse(input);
    const rows = await this.options.repository.findAllValues({ projectId: parsed.projectId });
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
    return this.getMutableSecret(input);
  }

  async create(input: Omit<CreateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret> {
    if (this.reservedNames.has(input.name)) {
      throw new SecretReservedNameError(input.name);
    }

    const stored = await this.options.repository.count({ projectId: input.projectId });
    if (stored >= this.maximumPerProject) {
      throw new SecretLimitReachedError(this.maximumPerProject);
    }

    return this.options.repository.create({
      projectId: input.projectId,
      name: input.name,
      encryptedValue: this.options.encryption.encrypt(input.value),
      actorId: await this.getAttributedUserId(input.projectId, by),
    });
  }

  async update(input: Omit<UpdateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret> {
    await this.getMutableSecret(input);

    return this.options.repository.update({
      projectId: input.projectId,
      id: input.id,
      encryptedValue: this.options.encryption.encrypt(input.value),
      actorId: await this.getAttributedUserId(input.projectId, by),
    });
  }

  /** Outside the per-project limit, as on main: a reserved row is not the customer's. */
  async createReserved(input: CreateReservedSecretInput): Promise<{ value: string }> {
    if (!this.reservedNames.has(input.name)) {
      throw new Error(`"${input.name}" is not a reserved project secret name`);
    }

    try {
      await this.options.repository.create({
        projectId: input.projectId,
        name: input.name,
        encryptedValue: this.options.encryption.encrypt(input.value),
        actorId: input.actorId,
      });

      return { value: input.value };
    } catch (error) {
      if (!(error instanceof SecretDuplicateError)) throw error;

      return { value: await this.getStoredValue(input) };
    }
  }

  async delete(input: DeleteSecretInput): Promise<void> {
    await this.getMutableSecret(input);
    await this.options.repository.delete({ projectId: input.projectId, id: input.id });
  }

  private async getStoredValue(input: { projectId: string; name: string }): Promise<string> {
    const rows = await this.options.repository.findAllValues({ projectId: input.projectId });
    const stored = rows.find((row) => row.name === input.name);
    if (!stored) throw new Error(`Project secret "${input.name}" vanished after a duplicate write`);

    return this.options.encryption.decrypt(stored.encryptedValue);
  }

  /** A key bound to nobody writes as the first member of the project's team, as main did. */
  private async getAttributedUserId(projectId: string, by?: SecretCaller): Promise<string> {
    if (by) return by.id;

    const project = await this.options.projects.getWithTeam(projectId);
    const bindings = await this.options.permissions.listTeamMemberBindings({
      organizationId: project.team.organizationId,
      teamIds: [project.teamId],
    });
    const [owner] = bindings.get(project.teamId) ?? [];
    if (!owner) throw new AuthenticatedActorRequiredError();

    return owner.userId;
  }

  /**
   * A reserved row answers exactly as an absent one: a caller must not be able
   * to tell that a product-owned credential is there.
   */
  private async getMutableSecret(input: { projectId: string; id: string }): Promise<Secret> {
    const secret = await this.options.repository.findById({
      projectId: input.projectId,
      id: input.id,
    });
    if (!secret || this.reservedNames.has(secret.name)) {
      throw new SecretNotFoundError();
    }

    return secret;
  }
}
