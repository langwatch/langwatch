/** Reads the projects one organization owns, for the legacy import to walk. */
export abstract class StoredObjectProjectSource {
  abstract listForOrganization(input: {
    organizationId: string;
  }): Promise<ReadonlyArray<{ id: string }>>;
}
