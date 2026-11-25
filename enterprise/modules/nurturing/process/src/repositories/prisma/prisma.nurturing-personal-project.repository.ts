// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  PrismaRepository,
  type PrismaRepositoryClient,
  skipTenantCheck,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";
import type {
  NurturingPersonalProjectRepository,
  NurturingPersonalProjectRow,
} from "../nurturing-personal-project.repository.ts";
import {
  type NurturingErasedUserDatabase,
  PrismaNurturingErasedUserRepository,
} from "./prisma.nurturing-erased-user.repository.ts";

type NurturingPersonalProjectDatabase = PrismaRepositoryClient<
  readonly ["NurturingPersonalProject"]
> &
  Pick<PrismaClient, "$executeRaw"> &
  NurturingErasedUserDatabase;

/**
 * Nurturing's `NurturingPersonalProject`: each personal project's owner, the first one kept, kept
 * free of an erased account by the erasure marks.
 */
export class PrismaNurturingPersonalProjectRepository
  extends PrismaRepository.for("NurturingPersonalProject")
  implements NurturingPersonalProjectRepository
{
  /**
   * `erasedUsers` defaults to the marks over the same client. It only writes marks: the write's
   * own checks always read them on this client, through `markExists`.
   */
  static create({
    prisma,
    erasedUsers = PrismaNurturingErasedUserRepository.create({ prisma }),
  }: Readonly<{
    prisma: NurturingPersonalProjectDatabase;
    erasedUsers?: Pick<NurturingErasedUserRepository, "markErased">;
  }>): PrismaNurturingPersonalProjectRepository {
    return new PrismaNurturingPersonalProjectRepository(prisma, erasedUsers);
  }

  readonly #database: NurturingPersonalProjectDatabase;
  readonly #erasedUsers: Pick<NurturingErasedUserRepository, "markErased">;

  private constructor(
    prisma: NurturingPersonalProjectDatabase,
    erasedUsers: Pick<NurturingErasedUserRepository, "markErased">,
  ) {
    super(prisma);
    this.#database = prisma;
    this.#erasedUsers = erasedUsers;
  }

  /**
   * One insert-ignore, so the first owner stays and a redelivery or a concurrent record raises
   * nothing. A marked owner gets no row: the re-check after the insert deletes any it stored. The
   * insert's own mark check only shortens how long a row its erasure raced is visible.
   */
  async recordOwner({
    projectId,
    organizationId,
    ownerUserId,
  }: NurturingPersonalProjectRow): Promise<void> {
    const marked = PrismaNurturingErasedUserRepository.markExists(ownerUserId);
    // The fact's own organization, compared with its bound id: the tenancy guard reads no tenant
    // from an INSERT ... SELECT's column list, only from a comparison.
    await this.#database.$executeRaw`
      INSERT INTO "NurturingPersonalProject" ("projectId", "organizationId", "ownerUserId")
      SELECT fact."projectId", fact."organizationId", fact."ownerUserId"
        FROM (VALUES (${projectId}, ${organizationId}, ${ownerUserId}))
             AS fact ("projectId", "organizationId", "ownerUserId")
       WHERE fact."organizationId" = ${organizationId} AND NOT ${marked}
      ON CONFLICT ("projectId") DO NOTHING
    `;
    // The insert can read no mark for an owner whose erasure has not committed it yet, then land
    // after the erasure's DELETE passed. This separate statement closes that race: if it starts
    // after the mark commits, it sees the mark; if before, the insert committed before the mark,
    // so the erasure's DELETE, which starts after its mark, sees the row.
    await this.#database.$executeRaw`
      DELETE FROM "NurturingPersonalProject"
       WHERE "organizationId" = ${organizationId} AND "projectId" = ${projectId}
         AND "ownerUserId" = ${ownerUserId} AND ${marked}`;
  }

  async findOwnerUserIds({ projectId }: Readonly<{ projectId: string }>): Promise<string[]> {
    const row = await this.prisma.nurturingPersonalProject.findUnique({ where: { projectId } });
    return row ? [row.ownerUserId] : [];
  }

  /**
   * Marks the account erased first, so an owner fact landing from then on writes no row for it,
   * then deletes its rows.
   */
  async forgetOwner({ ownerUserId }: Readonly<{ ownerUserId: string }>): Promise<void> {
    await this.#erasedUsers.markErased({ userId: ownerUserId });
    await this.#database.$executeRaw`${skipTenantCheck({
      // An erased account owns no personal project in any organization: the row goes by user.
      SKIP_TENANT_CHECK: true,
    })}
      DELETE FROM "NurturingPersonalProject" WHERE "ownerUserId" = ${ownerUserId}`;
  }
}
