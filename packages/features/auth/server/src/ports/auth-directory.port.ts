/**
 * The identity rows the auth transports read directly: the organization an
 * email domain claims, the person and organization a device grant names, and
 * whether a membership is still active.
 */
export abstract class AuthDirectoryPort {
  abstract tryFindOrganizationIdBySsoDomain(domain: string): Promise<string | null>;

  abstract tryFindPerson(
    userId: string,
  ): Promise<{ id: string; email: string | null; name: string | null } | null>;

  abstract tryFindOrganization(
    organizationId: string,
  ): Promise<{ id: string; name: string; slug: string } | null>;

  abstract maxSessionDurationDays(organizationId: string): Promise<number>;

  abstract hasActiveMembership(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;

  abstract tryFindLiveProject(params: {
    projectId: string;
    organizationId: string;
  }): Promise<AuthDirectoryProject | null>;
}

/** The project fields a device grant mints or names a key from. */
export type AuthDirectoryProject = {
  id: string;
  slug: string;
  name: string;
  apiKey: string;
  isPersonal: boolean;
  ownerUserId: string | null;
};
