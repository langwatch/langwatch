import {
  modelProviderSchema,
  type ModelDefaultScope,
  type ModelProvider,
} from "@langwatch/model-provider-contract";
import type {
  ModelProviderRecord,
  ModelProviderRepository,
} from "../model-provider.repository.ts";
import {
  byCreatedAtAscending,
  matchesAnyScope,
  MemoryModelProviderDatabase,
} from "./memory.model-provider.database.ts";

/**
 * A write refused because another row in the organization already answers to
 * the routing handle. The twin of the Postgres unique index, raised as its own
 * type so {@link MemoryModelProviderRepository.isRoutingHandleConflict} can
 * recognise it the way the Prisma repository recognises P2002.
 */
export class MemoryRoutingHandleConflictError extends Error {
  constructor(handle: string) {
    super(`routingHandle "${handle}" is already taken`);
    this.name = "MemoryRoutingHandleConflictError";
  }
}

export class MemoryModelProviderRepository implements ModelProviderRepository {
  static create(
    input: Readonly<{ database: MemoryModelProviderDatabase }>,
  ): MemoryModelProviderRepository {
    return new MemoryModelProviderRepository(input.database);
  }

  private constructor(private readonly database: MemoryModelProviderDatabase) {}

  tryFindById(input: {
    id: string;
    organizationId?: string;
    projectScopes?: ModelDefaultScope[];
  }): Promise<ModelProvider | null> {
    const row = this.database.providers.get(input.id);
    if (!row) return Promise.resolve(null);
    if (input.organizationId && row.organizationId !== input.organizationId) {
      return Promise.resolve(null);
    }
    if (input.projectScopes && !matchesAnyScope(row.scopes, input.projectScopes)) {
      return Promise.resolve(null);
    }

    return Promise.resolve(row);
  }

  tryFindByProviderForProject(input: {
    provider: string;
    projectScopes: ModelDefaultScope[];
  }): Promise<ModelProvider | null> {
    const rows = this.rows()
      .filter((row) => row.provider === input.provider)
      .filter((row) => matchesAnyScope(row.scopes, input.projectScopes))
      .sort(byCreatedAtAscending);

    return Promise.resolve(rows[0] ?? null);
  }

  listForProject(projectScopes: ModelDefaultScope[]): Promise<ModelProvider[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => matchesAnyScope(row.scopes, projectScopes))
        .sort(byCreatedAtAscending),
    );
  }

  listForOrganization(organizationId: string): Promise<ModelProvider[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => row.organizationId === organizationId)
        .sort(byCreatedAtAscending),
    );
  }

  // `async` so a refused handle arrives as a rejected promise, which is how
  // the Postgres unique index reports the same refusal.
  async create(input: ModelProviderRecord): Promise<ModelProvider> {
    return this.write(input);
  }

  async update(input: ModelProviderRecord): Promise<ModelProvider> {
    return this.write(input);
  }

  delete(input: { id: string }): Promise<void> {
    this.database.providers.delete(input.id);

    return Promise.resolve();
  }

  hasStoredCredentials(id: string): Promise<boolean> {
    const row = this.database.providers.get(id);

    return Promise.resolve(row?.customKeys !== null && row?.customKeys !== undefined);
  }

  isRoutingHandleConflict(error: unknown): boolean {
    return error instanceof MemoryRoutingHandleConflictError;
  }

  private write(input: ModelProviderRecord): ModelProvider {
    this.assertHandleIsFree(input);
    const row = modelProviderSchema.parse(input);
    this.database.providers.set(row.id, row);

    return row;
  }

  private assertHandleIsFree(input: ModelProviderRecord): void {
    const handle = input.routingHandle;
    if (!handle) return;

    const taken = this.rows().some(
      (row) =>
        row.id !== input.id &&
        row.organizationId === input.organizationId &&
        row.routingHandle === handle,
    );
    if (taken) throw new MemoryRoutingHandleConflictError(handle);
  }

  private rows(): ModelProvider[] {
    return [...this.database.providers.values()];
  }
}
