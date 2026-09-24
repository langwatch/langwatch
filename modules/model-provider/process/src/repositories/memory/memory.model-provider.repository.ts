import {
  ModelProviderNotFoundError,
  modelProviderSchema,
  type ModelDefaultScope,
  type ModelProvider,
  type ModelProviderUsageCount,
} from "@langwatch/model-provider-contract";

import type { ModelProviderRecord, ModelProviderRepository } from "../model-provider.repository.ts";
import type { MemoryModelProviderDatabase } from "./memory.model-provider.database.ts";
import { byCreatedAtAscending, matchesAnyScope } from "./memory.model-provider.database.ts";

/**
 * A write refused because another row in the organization already answers
 * to the routing handle — the twin of the Postgres unique index, so
 * `isRoutingHandleConflict` can recognise it the way Prisma recognises P2002.
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

  async countUsage({
    organizationIds,
  }: {
    organizationIds: readonly string[];
  }): Promise<ModelProviderUsageCount> {
    const rows = [...this.database.providers.values()].filter(
      (row) => row.organizationId !== undefined && organizationIds.includes(row.organizationId),
    );
    return {
      providers: [...new Set(rows.map((row) => row.provider))].toSorted(),
      ...(rows.length === 0
        ? {}
        : { firstModelProviderAt: Math.min(...rows.map((row) => row.createdAt.getTime())) }),
    };
  }

  getById(input: {
    id: string;
    organizationId?: string;
    projectScopes?: ModelDefaultScope[];
  }): Promise<ModelProvider> {
    const row = this.database.providers.get(input.id);
    if (!row) return Promise.reject(new ModelProviderNotFoundError());
    if (input.organizationId && row.organizationId !== input.organizationId) {
      return Promise.reject(new ModelProviderNotFoundError());
    }
    if (input.projectScopes && !matchesAnyScope(row.scopes, input.projectScopes)) {
      return Promise.reject(new ModelProviderNotFoundError());
    }

    return Promise.resolve(row);
  }

  getByProviderForProject(input: {
    provider: string;
    projectScopes: ModelDefaultScope[];
  }): Promise<ModelProvider> {
    const rows = this.rows()
      .filter((row) => row.provider === input.provider)
      .filter((row) => matchesAnyScope(row.scopes, input.projectScopes))
      .toSorted(byCreatedAtAscending);

    const [first] = rows;
    return first ? Promise.resolve(first) : Promise.reject(new ModelProviderNotFoundError());
  }

  findForProject(projectScopes: ModelDefaultScope[]): Promise<ModelProvider[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => matchesAnyScope(row.scopes, projectScopes))
        .toSorted(byCreatedAtAscending),
    );
  }

  findForOrganization(organizationId: string): Promise<ModelProvider[]> {
    return Promise.resolve(
      this.rows()
        .filter((row) => row.organizationId === organizationId)
        .toSorted(byCreatedAtAscending),
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
