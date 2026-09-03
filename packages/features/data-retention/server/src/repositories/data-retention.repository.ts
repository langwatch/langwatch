import type {
  RetentionCategory,
  RetentionPolicy,
  RetentionRow,
  ScopeAssignment,
} from "@langwatch/data-retention-contract";

export abstract class DataRetentionRepository {
  abstract findForProjectChain(input: {
    organizationId: string;
    scopes: ScopeAssignment[];
  }): Promise<RetentionRow[]>;
  abstract findAllInOrganization(input: {
    organizationId: string;
  }): Promise<RetentionPolicy[]>;
  abstract tryFindById(input: { id: string }): Promise<RetentionPolicy | null>;
  abstract upsertForScope(input: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy>;
  abstract deleteForScope(input: {
    scope: ScopeAssignment;
    category: RetentionCategory;
  }): Promise<void>;
}
