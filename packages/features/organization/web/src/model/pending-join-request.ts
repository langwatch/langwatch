/**
 * One waiting request, as the panel needs it. The requester's ADDRESS is not
 * here — the domain is what was matched and what an admin is deciding on.
 *
 * The shape lives here rather than beside the table because the query that
 * produces it is behavior and the table is a block: a block may read the model
 * and behavior may read the model, but neither may read the other.
 */
export interface PendingJoinRequest {
  joinRequestId: string;
  name: string;
  domain: string;
  requestedAt: Date;
  expiresAt: Date | null;
}
