import { emptyMfaEnrollment, type MfaEnrollmentState } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { MfaEnrollmentRepository } from "../../mfa-enrollment.repository";
import { mfaEnrollmentRowToState } from "./prisma.mfa-enrollment.mapper";

/** The enrollment head, and the person the membership question is asked through. */
export type PrismaMfaEnrollmentDatabase = Pick<PrismaClient, "mfaEnrollment" | "user">;

/**
 * The reads the two-step verification guards run against (D06). Postgres,
 * read-your-writes on the calling path and under the queue's per-person FIFO
 * on the staged path — the same serialization the identity guards get.
 */
export class PrismaMfaEnrollmentRepository implements MfaEnrollmentRepository {
  static create(database: PrismaMfaEnrollmentDatabase): PrismaMfaEnrollmentRepository {
    return new PrismaMfaEnrollmentRepository(database);
  }

  private constructor(private readonly database: PrismaMfaEnrollmentDatabase) {}

  /** Never null. Somebody who never started a setup reads as `NONE`, so
   *  every caller answers the question the same way rather than each
   *  inventing its own meaning for a missing row. */
  async findEnrollment({ userId }: { userId: string }): Promise<MfaEnrollmentState> {
    const row = await this.database.mfaEnrollment.findUnique({ where: { userId } });
    return row ? mfaEnrollmentRowToState(row) : emptyMfaEnrollment({ userId });
  }

  /**
   * The organizations this person belongs to that require a second factor.
   * Read here rather than trusted from the command, so a caller working from
   * a stale membership list cannot turn the factor off and keep the access.
   *
   * Read as a NESTED select off the person, not as a top-level
   * `organizationUser.findMany`. The question spans every organization one
   * person belongs to, so it has no single-organization predicate to offer and
   * `guardOrganizationId` (ADR-021) refuses it — a refusal that surfaces as a
   * 500, not as a skipped check. The guard sees top-level model operations
   * only, so going through the person asks the same question in a shape the
   * guard is right not to inspect.
   */
  async findRequiringOrganizationSlugs({ userId }: { userId: string }): Promise<readonly string[]> {
    const person = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        orgMemberships: {
          where: { organization: { mfaRequired: true } },
          select: { organization: { select: { slug: true } } },
        },
      },
    });
    return (person?.orgMemberships ?? []).map((membership) => membership.organization.slug);
  }
}
