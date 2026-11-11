// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository, type PrismaRepositoryClient } from "@langwatch/prisma-client";

import type {
  NurturingPersonalProjectRepository,
  NurturingPersonalProjectRow,
} from "../nurturing-personal-project.repository.ts";

type NurturingPersonalProjectDatabase = PrismaRepositoryClient<
  readonly ["NurturingPersonalProject"]
>;

/** Nurturing's `NurturingPersonalProject`: each personal project's owner, the first one kept. */
export class PrismaNurturingPersonalProjectRepository
  extends PrismaRepository.for("NurturingPersonalProject")
  implements NurturingPersonalProjectRepository
{
  static create({
    prisma,
  }: Readonly<{
    prisma: NurturingPersonalProjectDatabase;
  }>): PrismaNurturingPersonalProjectRepository {
    return new PrismaNurturingPersonalProjectRepository(prisma);
  }

  private constructor(prisma: NurturingPersonalProjectDatabase) {
    super(prisma);
  }

  async recordOwner(input: NurturingPersonalProjectRow): Promise<void> {
    // ON CONFLICT DO NOTHING: a redelivery or a concurrent record never raises a P2002.
    await this.prisma.nurturingPersonalProject.createMany({
      data: [{ ...input }],
      skipDuplicates: true,
    });
  }

  async findOwnerUserIds({ projectId }: Readonly<{ projectId: string }>): Promise<string[]> {
    const row = await this.prisma.nurturingPersonalProject.findUnique({ where: { projectId } });
    return row ? [row.ownerUserId] : [];
  }
}
