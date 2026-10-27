/**
 * The extra context a join-request notification's copy carries, beyond who
 * to address: why the organization exists, how many requests from a domain
 * were already approved, and a lapsed requester's own personal project link.
 */
export abstract class JoinRequestNotificationContextRepository {
  /**
   * Why the organization came, for the one message a new member reads first.
   * A null intent is a supported answer — plenty of organizations never said.
   * Throws `OrganizationNotFoundError` when no organization carries this id.
   */
  abstract getOrganizationIntent(
    organizationId: string,
  ): Promise<Readonly<{ primaryIntent: "AGENT_GOVERNANCE" | "LLM_OPS" | null }>>;

  /** How many join requests from this domain have already been approved. */
  abstract countApprovedFromDomain(input: {
    organizationId: string;
    domain: string;
  }): Promise<number>;

  /**
   * The requester's own personal teams across organizations, oldest first.
   * Empty when they have none yet, the ordinary case for a first sign-in.
   */
  abstract findPersonalTeamSlugs(userId: string): Promise<string[]>;
}
