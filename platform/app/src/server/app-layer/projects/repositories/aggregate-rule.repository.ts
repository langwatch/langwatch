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
