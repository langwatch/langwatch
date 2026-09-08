import {
  dataPrivacyPolicySchema,
  dataPrivacyRowSchema,
  type DataPrivacyConfig,
  type DataPrivacyPolicy,
  type DataPrivacyRow,
  type DataPrivacyScope,
} from "@langwatch/data-privacy-contract";
import { generate } from "@langwatch/ksuid";
import { nowInstant, toDate } from "@langwatch/time";
import type { DataPrivacyPolicyRepository } from "../data-privacy.repository.ts";

const DATA_PRIVACY_POLICY_KSUID_RESOURCE = "privacy";

/**
 * A rule's identity is the (scope, personalOnly) triple, exactly as the stored
 * unique key spells it — the organization is written by the rule, not part of
 * what makes it the same rule.
 */
function sameRule(row: DataPrivacyPolicy, scope: DataPrivacyScope, personalOnly: boolean): boolean {
  return (
    row.scopeType === scope.scopeType &&
    row.scopeId === scope.scopeId &&
    row.personalOnly === personalOnly
  );
}

export class MemoryDataPrivacyPolicyRepository implements DataPrivacyPolicyRepository {
  #rows: DataPrivacyPolicy[] = [];

  private constructor() {}

  static create(): MemoryDataPrivacyPolicyRepository {
    return new MemoryDataPrivacyPolicyRepository();
  }

  async findForProjectChain(input: {
    organizationId: string;
    scopes: Array<Pick<DataPrivacyRow, "scopeType" | "scopeId" | "personalOnly">>;
  }): Promise<DataPrivacyRow[]> {
    return this.#rows
      .filter(
        (row) =>
          row.organizationId === input.organizationId &&
          input.scopes.some(
            (scope) => scope.scopeType === row.scopeType && scope.scopeId === row.scopeId,
          ),
      )
      .map((row) =>
        dataPrivacyRowSchema.parse({
          scopeType: row.scopeType,
          scopeId: row.scopeId,
          personalOnly: row.personalOnly,
          config: row.config,
        }),
      );
  }

  async findAllInOrganization(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    return this.#rows
      .filter((row) => row.organizationId === input.organizationId)
      .map((row) => structuredClone(row));
  }

  async upsertForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy> {
    const now = toDate(nowInstant());
    const previous = this.#rows.find((row) => sameRule(row, input.scope, input.personalOnly));
    const row = dataPrivacyPolicySchema.parse({
      id: previous?.id ?? generate(DATA_PRIVACY_POLICY_KSUID_RESOURCE).toString(),
      organizationId: input.organizationId,
      scopeType: input.scope.scopeType,
      scopeId: input.scope.scopeId,
      personalOnly: input.personalOnly,
      config: input.config,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });

    this.#rows = [...this.#rows.filter((existing) => existing.id !== row.id), row];

    return structuredClone(row);
  }

  async deleteForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void> {
    this.#rows = this.#rows.filter(
      (row) =>
        !(
          row.organizationId === input.organizationId &&
          sameRule(row, input.scope, input.personalOnly)
        ),
    );
  }
}
