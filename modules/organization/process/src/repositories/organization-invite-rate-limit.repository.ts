/**
 * The process's fixed-window counter, as the invitation throttle spends it. A port rather than a
 * Redis client, so the admin's resend and the invitee's re-request spend the same allowance.
 * `count` defaults to 1: a batch creation spends one per invited address.
 */
export interface OrganizationInviteRateLimitRepository {
  limit(
    input: Readonly<{ key: string; windowSeconds: number; max: number; count?: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>>;
}
