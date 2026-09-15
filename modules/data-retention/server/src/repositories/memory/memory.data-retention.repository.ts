import {
  retentionPolicySchema,
  retentionRowSchema,
  type RetentionCategory,
  type RetentionPolicy,
  type RetentionRow,
  type ScopeAssignment,
} from "@langwatch/data-retention-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import type { DataRetentionRepository } from "../data-retention.repository.ts";

const RETENTION_POLICY_KSUID_RESOURCE = "retention";

function sameRule(
  row: RetentionPolicy,
  scope: ScopeAssignment,
  category: RetentionCategory,
): boolean {
  return (
    row.scopeType === scope.scopeType && row.scopeId === scope.scopeId && row.category === category
  );
}

export class MemoryDataRetentionRepository implements DataRetentionRepository {
  #rows: RetentionPolicy[] = [];

  private constructor() {}

  static create(): MemoryDataRetentionRepository {
    return new MemoryDataRetentionRepository();
  }

  async findForProjectChain(input: {
    organizationId: string;
    scopes: ScopeAssignment[];
  }): Promise<RetentionRow[]> {
    return this.#rows
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          input.scopes.some(
            (scope) => scope.scopeType === row.scopeType && scope.scopeId === row.scopeId,
          ),
      )
      .map((row) =>
        retentionRowSchema.parse({
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          category: row.category,
          retentionDays: row.retentionDays,
        }),
      );
  }

  async findAllInOrganization(input: { organizationId: string }): Promise<RetentionPolicy[]> {
    return this.#rows
      .filter((row) => row.organizationId === input.organizationId)
      .map((row) => structuredClone(row));
  }

  async upsertForScope(input: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy> {
    const now = toDate(nowInstant());
    const previous = this.#rows.find((row) => sameRule(row, input.scope, input.category));
    const row = retentionPolicySchema.parse({
      id: previous?.id ?? generate(RETENTION_POLICY_KSUID_RESOURCE).toString(),
      organizationId: input.organizationId,
      scopeType: input.scope.scopeType,
      scopeId: input.scope.scopeId,
      category: input.category,
      retentionDays: input.retentionDays,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });

    this.#rows = [...this.#rows.filter((existing) => existing.id !== row.id), row];

    return structuredClone(row);
  }

  async deleteForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void> {
    this.#rows = this.#rows.filter((row) => !sameRule(row, input.scope, input.category));
  }
}
