/** Reads the projects one organization owns, for the legacy import to walk. */
export abstract class StoredObjectProjectSourceRepository {
  abstract findForOrganization(input: {
    organizationId: string;
  }): Promise<readonly { id: string }[]>;
}
