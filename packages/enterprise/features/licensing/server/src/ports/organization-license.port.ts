/**
 * The one licence read a plan resolution makes: the key an organization
 * activated, or nothing.
 *
 * Deliberately narrower than {@link LicenseStoragePort}, which also writes the
 * licence row and answers SEAT COUNTS. Those counts belong to the licence
 * ENFORCEMENT vertical — full-versus-lite classification, pending invitations,
 * custom roles — and a process that only resolves plans has no reason to
 * compose them. Asking for the whole storage port there would make every root
 * that reads a licence carry a collaborator nothing on that path calls.
 */
export abstract class OrganizationLicensePort {
  abstract tryReadLicense(organizationId: string): Promise<string | null>;
}
