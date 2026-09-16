import type { MfaEnrollmentState } from "@langwatch/identity-contract";

/**
 * How the two-step verification guards see current state: reads over the
 * `MfaEnrollment` projection, and the one organization read the disable
 * guard needs. The app implements this with Prisma.
 */

/**
 * Serialized the same way the identity guards are — read-your-writes on the
 * calling path, the queue's per-user FIFO on the staged path — so a guard
 * reads the enrollment first and states only what it does not carry.
 */
export abstract class MfaEnrollmentRepository {
  /** This person's enrollment as the projection knows it. Never null: a
   *  person who never started one reads as `NONE`, so every caller answers
   *  the question the same way. */
  abstract findEnrollment(args: { userId: string }): Promise<MfaEnrollmentState>;
  /**
   * Organizations requiring a second factor. Read, not trusted from the
   * caller: the disable guard must name WHICH organization is asking, not
   * work from a caller's possibly-stale membership list.
   */
  abstract findRequiringOrganizationSlugs(args: { userId: string }): Promise<readonly string[]>;
}
