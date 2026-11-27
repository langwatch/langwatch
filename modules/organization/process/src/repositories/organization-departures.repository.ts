/**
 * The people who left an organization: removed, or disabled and so no longer holding a seat.
 * Read from the organization's own member facts, since a removal deletes the membership row.
 */
export abstract class OrganizationDeparturesRepository {
  /** Each person removed or disabled at or after `since`, once, in no particular order. */
  abstract findDepartedSince(input: { organizationId: string; since: number }): Promise<string[]>;
}
