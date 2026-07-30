import type {
  CreateEphemeralAccountParams,
  EphemeralAccount,
  EphemeralAccountRepository,
} from "@langwatch/ai-onboarding";
import { agentSlugSchema } from "@langwatch/contracts/agent-onboarding";
import type { PrismaClient } from "@prisma/client";

/**
 * The Prisma half of `EphemeralAccountRepository`.
 *
 * Lives in the app rather than in `@langwatch/ai-onboarding` because the
 * Prisma client is *generated* from this app's schema — a package that
 * imported it would typecheck against whatever stub happened to be installed
 * next to it. The port stays in the package; only this binding is here.
 */

/** The columns the domain reads. Kept explicit so a schema change that drops
 *  one is a compile error rather than an `undefined` at runtime. */
interface EphemeralAccountRow {
  id: string;
  organizationId: string;
  projectId: string;
  projectSlug: string;
  projectName: string;
  agent: string;
  provisionedAt: Date;
  ingestionStopsAt: Date | null;
  deleteAfter: Date | null;
  claimedAt: Date | null;
  claimedByUserId: string | null;
}

export class PrismaEphemeralAccountRepository
  implements EphemeralAccountRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): PrismaEphemeralAccountRepository {
    return new PrismaEphemeralAccountRepository(prisma);
  }

  async create(
    params: CreateEphemeralAccountParams,
  ): Promise<EphemeralAccount> {
    const row = await this.prisma.ephemeralAccount.create({
      data: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        projectSlug: params.projectSlug,
        projectName: params.projectName,
        agent: params.agent,
        claimTokenHash: params.claimTokenHash,
        fingerprintHash: params.fingerprintHash,
        ipHash: params.ipHash,
        provisionedAt: params.provisionedAt,
        ingestionStopsAt: params.ingestionStopsAt,
        deleteAfter: params.deleteAfter,
      },
    });
    return toDomain(row);
  }

  async findByClaimTokenHash(
    claimTokenHash: string,
  ): Promise<EphemeralAccount | null> {
    const row = await this.prisma.ephemeralAccount.findUnique({
      where: { claimTokenHash },
    });
    return row === null ? null : toDomain(row);
  }

  async findById(id: string): Promise<EphemeralAccount | null> {
    const row = await this.prisma.ephemeralAccount.findUnique({
      where: { id },
    });
    return row === null ? null : toDomain(row);
  }

  /**
   * Conditional on still being unclaimed, in the UPDATE itself.
   *
   * A read-then-write in the service would let two browser tabs approving the
   * same handoff both succeed, and would leave a claim racing the reaper to
   * resolve on whichever transaction happened to commit last. `updateMany`
   * with `claimedAt: null` in the WHERE makes the database pick exactly one
   * winner; a zero count is the loser, and the caller turns that into an
   * already-claimed error.
   *
   * Clearing both deadlines is what takes the row out of the reaper's work
   * list — that query is `deleteAfter <= now`, which a null can never match.
   */
  async markClaimed(params: {
    id: string;
    userId: string;
    claimedAt: Date;
  }): Promise<EphemeralAccount | null> {
    const { count } = await this.prisma.ephemeralAccount.updateMany({
      where: { id: params.id, claimedAt: null },
      data: {
        claimedAt: params.claimedAt,
        claimedByUserId: params.userId,
        ingestionStopsAt: null,
        deleteAfter: null,
      },
    });
    if (count === 0) return null;
    return this.findById(params.id);
  }
}

function toDomain(row: EphemeralAccountRow): EphemeralAccount {
  return {
    id: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    projectSlug: row.projectSlug,
    projectName: row.projectName,
    // Only ever written from a validated enum, so a parse failure means the
    // column was edited out of band — louder than silently defaulting.
    agent: agentSlugSchema.parse(row.agent),
    provisionedAt: row.provisionedAt,
    ingestionStopsAt: row.ingestionStopsAt,
    deleteAfter: row.deleteAfter,
    claimedAt: row.claimedAt,
    claimedByUserId: row.claimedByUserId,
  };
}
