/**
 * The identity rows the auth transports read directly: the organization an
 * email domain claims, the person and organization a device grant names, and
 * whether a membership is still active.
 */
export abstract class AuthDirectory {
  /** Throws `OrganizationNotFoundError` when no organization claims the domain. */
  abstract getOrganizationIdBySsoDomain(domain: string): Promise<string>;

  /** Throws `UserNotFoundError`. */
  abstract getPerson(
    userId: string,
  ): Promise<{ id: string; email: string | null; name: string | null }>;

  /** Throws `OrganizationNotFoundError`. */
  abstract getOrganization(
    organizationId: string,
  ): Promise<{ id: string; name: string; slug: string }>;

  abstract maxSessionDurationDays(organizationId: string): Promise<number>;

  abstract hasActiveMembership(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;

  /** Whether the person holds a Developer seat (ADR-171): a personal project, nothing shared. */
  abstract holdsDeveloperSeat(params: { userId: string; organizationId: string }): Promise<boolean>;

  /** An unarchived project of the organization; throws `ProjectNotFoundError`. */
  abstract getLiveProject(params: {
    projectId: string;
    organizationId: string;
  }): Promise<AuthDirectoryProject>;

  /** An unarchived project of the organization by id, else slug; throws `ProjectNotFoundError`. */
  abstract getLiveProjectByRef(params: {
    projectRef: string;
    organizationId: string;
  }): Promise<AuthDirectoryProject>;
}

/** The project fields a device grant binds a session to. */
export type AuthDirectoryProject = {
  id: string;
  slug: string;
  name: string;
  teamId: string;
  isPersonal: boolean;
  ownerUserId: string | null;
};
