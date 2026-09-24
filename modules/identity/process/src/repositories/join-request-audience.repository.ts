/**
 * Who a join-request notification reaches, and what they are called.
 * Absences here are real, not defensive — an unwritten fold, a renamed org,
 * an addressless user — and the service above decides what each one means.
 */
export type JoinRequestAudienceProfile = Readonly<{ name: string | null; email: string | null }>;

export abstract class JoinRequestAudience {
  /** Throws `JoinRequestNotFoundError` when no request carries this id. */
  abstract getRequesterId(input: { joinRequestId: string }): Promise<string>;

  /** Throws `OrganizationNotFoundError` when no organization carries this id. */
  abstract getOrganizationName(input: { organizationId: string }): Promise<string>;

  abstract findAdminEmails(input: { organizationId: string }): Promise<string[]>;

  /** Throws `UserNotFoundError` when no user carries this id; both fields may be unset. */
  abstract getUserProfile(input: { userId: string }): Promise<JoinRequestAudienceProfile>;
}
