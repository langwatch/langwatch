import type {
  RetentionCategory,
  RetentionPolicy,
  RetentionRow,
  ScopeAssignment,
} from "@langwatch/data-retention-contract";

export interface DataRetentionRepository {
  findForProjectChain(input: {
    organizationId: string;
    scopes: ScopeAssignment[];
  }): Promise<RetentionRow[]>;
  findAllInOrganization(input: { organizationId: string }): Promise<RetentionPolicy[]>;
  upsertForScope(input: {
    organizationId: string;
    scope: ScopeAssignment;
    category: RetentionCategory;
    retentionDays: number;
  }): Promise<RetentionPolicy>;
  deleteForScope(input: { scope: ScopeAssignment; category: RetentionCategory }): Promise<void>;
}
