/** Reads the projects one organization owns, for the legacy import to walk. */
export abstract class StoredObjectProjectSourcePort {
  abstract listForOrganization(input: {
    organizationId: string;
  }): Promise<ReadonlyArray<{ id: string }>>;
}
