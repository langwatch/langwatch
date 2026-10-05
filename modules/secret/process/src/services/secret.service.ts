import { AuthenticatedActorRequiredError } from "@langwatch/api";
import {
  AuthzScopeNotFoundError,
  type AuthzApi,
  type AuthzScopeRef,
} from "@langwatch/authz-contract";
import {
  getSecretValuesByNameInputSchema,
  listSecretsInputSchema,
  MAX_SECRETS_PER_PROJECT,
  SecretDuplicateError,
  SecretLimitReachedError,
  SecretNotFoundError,
  SecretReservedNameError,
  SecretUnreadableError,
  type CreateReservedSecretInput,
  type CreateSecretInput,
  type DeleteSecretInput,
  type GetSecretInput,
  type GetSecretValuesByNameInput,
  type ListSecretsInput,
  type Secret,
  type SecretCaller,
  type UpdateSecretInput,
} from "@langwatch/secret-contract";

import type { SecretRepository } from "../repositories/secret.repository.ts";

export interface SecretServiceOptions {
  repository: SecretRepository;
  reservedNames: readonly string[];
  maximumPerProject?: number;
  permissions: Pick<AuthzApi, "getScope" | "listTeamMemberBindings">;
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
      if (!row.readable) {
        throw new Error(`Failed to decrypt project secret "${row.name}": ${row.reason}`);
      }
      values[row.name] = row.value;
    }

    return values;
  }

  /** A reserved name is never read: it answers exactly as a name nothing is stored under. */
  async getValuesByName(input: GetSecretValuesByNameInput): Promise<Record<string, string>> {
    const parsed = getSecretValuesByNameInputSchema.parse(input);
    const names = parsed.names.filter((name) => !this.reservedNames.has(name));
    if (names.length === 0) return {};

    const rows = await this.options.repository.findValuesByName({
      projectId: parsed.projectId,
      names,
    });
    const values: Record<string, string> = {};
    for (const row of rows) {
      if (!row.readable) throw new SecretUnreadableError(row.name);
      values[row.name] = row.value;
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
      value: input.value,
      actorId: await this.getAttributedUserId(input.projectId, by),
    });
  }

  async update(input: Omit<UpdateSecretInput, "actorId">, by?: SecretCaller): Promise<Secret> {
    await this.getMutableSecret(input);

    return this.options.repository.update({
      projectId: input.projectId,
      id: input.id,
      value: input.value,
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
        value: input.value,
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
    if (!stored.readable) throw new Error(stored.reason);

    return stored.value;
  }

  /** A key bound to nobody writes as the first member of the project's team, as main did. */
  private async getAttributedUserId(projectId: string, by?: SecretCaller): Promise<string> {
    if (by) return by.id;

    const scope = await this.getProjectScope(projectId);
    const bindings = await this.options.permissions.listTeamMemberBindings({
      organizationId: scope.organizationId,
      teamIds: [scope.teamId],
    });
    const [owner] = bindings.get(scope.teamId) ?? [];
    if (!owner) throw new AuthenticatedActorRequiredError();

    return owner.userId;
  }

  /** The project's team and organization; a project authz cannot resolve answers as not found. */
  private async getProjectScope(
    projectId: string,
  ): Promise<Extract<AuthzScopeRef, { type: "project" }>> {
    const scope = await this.options.permissions.getScope({ projectId }).catch((error: unknown) => {
      if (AuthzScopeNotFoundError.is(error)) return null;
      throw error;
    });
    if (scope?.type !== "project") throw new SecretNotFoundError();

    return scope;
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
