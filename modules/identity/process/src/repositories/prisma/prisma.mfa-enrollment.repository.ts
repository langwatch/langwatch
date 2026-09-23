import { emptyMfaEnrollment, type MfaEnrollmentState } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { MfaEnrollmentRepository } from "../mfa-enrollment.repository.ts";
import { mfaEnrollmentRowToState } from "./prisma.mfa-enrollment.mapper.ts";

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
   * Organizations this person belongs to that require a second factor. Read
   * here, not trusted from the command, so a stale list can't turn the
   * factor off. A NESTED select — a top-level query would need `guardOrganizationId` (ADR-021).
   */
  async findRequiringOrganizationSlugs({ userId }: { userId: string }): Promise<readonly string[]> {
    const person = await this.database.user.findUnique({
      where: { id: userId },
      select: {
        orgMemberships: {
          where: { disabledAt: null, organization: { mfaRequired: true } },
          select: { organization: { select: { slug: true } } },
        },
      },
    });
    return (person?.orgMemberships ?? []).map((membership) => membership.organization.slug);
  }
}
