/**
 * Where usage is metered and priced: project's `Project` rows and organization's
 * `Organization` columns, read through the shares their owners declare (R40, C1).
 */

/** The organisation a project meters against, or that it has none to meter against. */
export type ProjectPlacement = { kind: "placed"; organizationId: string } | { kind: "unplaced" };

export interface TenancyRepository {
  /** An unknown project, or one whose team has no organisation, is unplaced. */
  getProjectPlacement(input: { projectId: string }): Promise<ProjectPlacement>;
  /** Every project the organisation owns, archived ones included. */
  findProjectIds(input: { organizationId: string }): Promise<string[]>;
  /** The organisations owning at least one project: an organisation without one counts zero. */
  findMeteredOrganizationIds(): Promise<string[]>;
  /** The currency an organisation is priced in; an unknown one has the schema's default. */
  getCurrency(input: { organizationId: string }): Promise<"USD" | "EUR">;
  /** The per-file dataset limit an operator set, in MiB; null when none is set or unknown. */
  getDatasetLimits(input: { organizationId: string }): Promise<{ attachmentMaxMb: number | null }>;
}
