/**
 * Who a join-request notification reaches, and what they are called.
 * Absences here are real, not defensive — an unwritten fold, a renamed org,
 * an addressless user — and the service above decides what each one means.
 */
export abstract class JoinRequestAudience {
  /** Throws `JoinRequestNotFoundError` when no request carries this id. */
  abstract getRequesterId(input: { joinRequestId: string }): Promise<string>;

  abstract tryFindOrganizationName(input: { organizationId: string }): Promise<string | null>;

  abstract findAdminEmails(input: { organizationId: string }): Promise<string[]>;

  abstract tryFindDisplayName(input: { userId: string }): Promise<string | null>;

  abstract tryFindEmail(input: { userId: string }): Promise<string | null>;
}
