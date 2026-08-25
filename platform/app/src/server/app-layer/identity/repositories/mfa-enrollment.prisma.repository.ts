import {
  emptyMfaEnrollment,
  type MfaEnrollmentState,
} from "@langwatch/identity";
import type { MfaEnrollmentRepository } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import { rowToEnrollment } from "./mfa-enrollment-projection.prisma.repository";

/**
 * The reads the two-step verification guards run against (D06). Postgres,
 * read-your-writes on the calling path and under the queue's per-person FIFO
 * on the staged path — the same serialization the identity guards get.
 */
export class PrismaMfaEnrollmentRepository implements MfaEnrollmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Never null. Somebody who never started a setup reads as `NONE`, so
   *  every caller answers the question the same way rather than each
   *  inventing its own meaning for a missing row. */
  async findEnrollment({
    userId,
  }: {
    userId: string;
  }): Promise<MfaEnrollmentState> {
    const row = await this.prisma.mfaEnrollment.findUnique({
      where: { userId },
    });
    return row ? rowToEnrollment(row) : emptyMfaEnrollment({ userId });
  }

  /**
   * The organizations this person belongs to that require a second factor.
   * Read here rather than trusted from the command, so a caller working from
   * a stale membership list cannot turn the factor off and keep the access.
   */
  async findRequiringOrganizationSlugs({
    userId,
  }: {
    userId: string;
  }): Promise<readonly string[]> {
    const memberships = await this.prisma.organizationUser.findMany({
      where: { userId, organization: { mfaRequired: true } },
      select: { organization: { select: { slug: true } } },
    });
    return memberships.map((membership) => membership.organization.slug);
  }
}
