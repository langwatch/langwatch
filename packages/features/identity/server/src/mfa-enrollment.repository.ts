import type { MfaEnrollmentState } from "@langwatch/identity-contract";

/**
 * How the two-step verification guards see current state: reads over the
 * `MfaEnrollment` projection, and the one organization read the disable
 * guard needs. The app implements this with Prisma.
 *
 * Serialized the same way the identity guards are — read-your-writes on the
 * calling path, the queue's per-user FIFO on the staged path — so a guard
 * reads the enrollment first and states only what it does not carry.
 */
export interface MfaEnrollmentRepository {
  /** This person's enrollment as the projection knows it. Never null: a
   *  person who never started one reads as `NONE`, so every caller answers
   *  the question the same way. */
  findEnrollment(args: { userId: string }): Promise<MfaEnrollmentState>;
  /**
   * Slugs of the organizations this person belongs to that require a second
   * factor. Read rather than trusted from the caller: the disable guard has
   * to name WHICH organization is asking, and a caller that computed it
   * itself could be working from a stale membership list.
   */
  findRequiringOrganizationSlugs(args: { userId: string }): Promise<readonly string[]>;
}
