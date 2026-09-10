/**
 * Who a join-request notification reaches, and what they are called.
 *
 * Every read answers with a name or an address for somebody who is already
 * entitled to the message — an admin of the organization being asked, or the
 * person who did the asking. Nothing here enumerates a membership for a
 * decision; that is `JoinRequestReadRepository`'s side of the feature, and it
 * answers only in counts and enums for exactly this reason.
 *
 * The absences are real rather than defensive: a request whose row the fold
 * has not written yet, an organization renamed out from under a queued wake, a
 * user with no address at all. The service above decides what each one means,
 * because the answer differs — a missing address means send nothing, a missing
 * organization name means send the mail with a generic one.
 */
export abstract class JoinRequestAudiencePort {
  abstract tryFindRequesterId(input: { joinRequestId: string }): Promise<string | null>;

  abstract tryFindOrganizationName(input: { organizationId: string }): Promise<string | null>;

  abstract findAdminEmails(input: { organizationId: string }): Promise<string[]>;

  abstract tryFindDisplayName(input: { userId: string }): Promise<string | null>;

  abstract tryFindEmail(input: { userId: string }): Promise<string | null>;
}
