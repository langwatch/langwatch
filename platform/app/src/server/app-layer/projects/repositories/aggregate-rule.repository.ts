import type { AggregateRule } from "../aggregate-rule";

/** The reads an aggregate rule needs to decide its members. */
export interface AggregateRuleRepository {
  /**
   * Live personal projects of the organisation, optionally narrowed to those
   * whose owner's CURRENT department is `departmentId` (ADR-144 decision 2:
   * history is ignored in v1). Ordinary kinds only.
   */
  findPersonalProjectIds(params: {
    organizationId: string;
    departmentId?: string;
  }): Promise<string[]>;
  /**
   * Of `projectIds`, the live ones this organisation owns whose kind an
   * aggregate may read (not the hidden governance project, not an aggregate).
   */
  findReadableProjectIds(params: {
    organizationId: string;
    projectIds: readonly string[];
  }): Promise<string[]>;
  /** Whether the department belongs to this organisation and is live. */
  departmentBelongsTo(params: {
    organizationId: string;
    departmentId: string;
  }): Promise<boolean>;
}

/** An aggregate project as the reconciler needs it: where it lives, and its rule. */
export type StoredAggregateProject = {
  id: string;
  organizationId: string;
  /** The project or its team is archived; an archived aggregate reads nothing. */
  archived: boolean;
  /** Null when the stored column does not parse as a rule. */
  rule: AggregateRule | null;
};

/** The reads the reconciler (ADR-144 block E) makes about aggregates themselves. */
export interface AggregateProjectRepository {
  /** The aggregate with this id, or null when no project of kind aggregate has it. */
  findAggregate(params: {
    aggregateProjectId: string;
  }): Promise<StoredAggregateProject | null>;
  /** The organisation's live aggregates, ordered by id. */
  findLiveAggregateIds(params: { organizationId: string }): Promise<string[]>;
}
