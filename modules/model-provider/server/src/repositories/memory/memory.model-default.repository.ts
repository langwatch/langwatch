import {
  modelDefaultConfigSchema,
  type ModelDefaultConfig,
  type ModelDefaultScope,
} from "@langwatch/model-provider-contract";
import type {
  ModelDefaultConfigSaveInput,
  ModelDefaultRepository,
} from "../model-default.repository.ts";
import {
  byCreatedAtDescending,
  matchesAnyScope,
  MemoryModelProviderDatabase,
} from "./memory.model-provider.database.ts";

/**
 * The default-models cascade in memory.
 *
 * A scope is held by at most one config, which the Postgres twin enforces by
 * detaching the scope from whoever held it and deleting a config left holding
 * nothing. Both happen here for the same reason: a scope held twice makes the
 * cascade answer differently depending on which row is read first.
 */
export class MemoryModelDefaultRepository implements ModelDefaultRepository {
  static create(
    input: Readonly<{ database: MemoryModelProviderDatabase }>,
  ): MemoryModelDefaultRepository {
    return new MemoryModelDefaultRepository(input.database);
  }

  private constructor(private readonly database: MemoryModelProviderDatabase) {}

  listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelDefaultConfig[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => matchesAnyScope(row.scopes, projectScopes))
        .sort(byCreatedAtDescending),
    );
  }

  listForOrganization(organizationId: string): Promise<ModelDefaultConfig[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => row.organizationId === organizationId)
        .sort(byCreatedAtDescending),
    );
  }

  tryGetById(id: string): Promise<ModelDefaultConfig | null> {
    return Promise.resolve(this.database.defaults.get(id) ?? null);
  }

  tryFindByScope(scope: ModelDefaultScope): Promise<ModelDefaultConfig | null> {
    return Promise.resolve(this.newestOnScope(scope));
  }

  save(input: ModelDefaultConfigSaveInput): Promise<ModelDefaultConfig> {
    this.releaseScopes(input.scopes, input.id);
    const existing = this.database.defaults.get(input.id);
    const row = modelDefaultConfigSchema.parse({
      id: input.id,
      organizationId: input.organizationId,
      config: input.config,
      scopes: input.scopes,
      authorId: input.authorId,
      createdAt: existing?.createdAt ?? input.createdAt ?? new Date(),
      updatedAt: new Date(),
    });
    this.database.defaults.set(row.id, row);

    return Promise.resolve(row);
  }

  set(input: {
    id: string;
    organizationId: string;
    scope: ModelDefaultScope;
    key: string;
    model: string | null;
    authorId: string | null;
  }): Promise<void> {
    const existing = this.newestOnScope(input.scope);
    const config = { ...(existing?.config ?? {}) };
    if (input.model === null) delete config[input.key];
    else config[input.key] = input.model;

    if (Object.keys(config).length === 0) {
      if (existing) this.database.defaults.delete(existing.id);

      return Promise.resolve();
    }

    return this.save({
      id: existing?.id ?? input.id,
      organizationId: input.organizationId,
      config,
      scopes: [input.scope],
      authorId: input.authorId,
    }).then(() => undefined);
  }

  delete(id: string): Promise<void> {
    this.database.defaults.delete(id);

    return Promise.resolve();
  }

  /** Detaches the scopes from whoever else held them, deleting the emptied. */
  private releaseScopes(scopes: readonly ModelDefaultScope[], keptId: string): void {
    for (const row of this.rows()) {
      if (row.id === keptId) continue;

      const remaining = row.scopes.filter((scope) => !matchesAnyScope([scope], scopes));
      if (remaining.length === row.scopes.length) continue;

      if (remaining.length === 0) this.database.defaults.delete(row.id);
      else this.database.defaults.set(row.id, { ...row, scopes: remaining });
    }
  }

  private newestOnScope(scope: ModelDefaultScope): ModelDefaultConfig | null {
    const rows = this.rows()
      .filter((row) => matchesAnyScope(row.scopes, [scope]))
      .sort(byCreatedAtDescending);

    return rows[0] ?? null;
  }

  private rows(): ModelDefaultConfig[] {
    return [...this.database.defaults.values()];
  }
}
