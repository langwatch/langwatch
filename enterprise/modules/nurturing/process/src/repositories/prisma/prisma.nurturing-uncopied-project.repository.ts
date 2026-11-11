// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository, type PrismaRepositoryClient } from "@langwatch/prisma-client";

import type { NurturingUncopiedProjectRepository } from "../nurturing-uncopied-project.repository.ts";

type NurturingUncopiedProjectDatabase = PrismaRepositoryClient<
  readonly ["NurturingUncopiedProject"]
>;

/** Nurturing's `NurturingUncopiedProject`: when it first saw each project with no placement copy. */
export class PrismaNurturingUncopiedProjectRepository
  extends PrismaRepository.for("NurturingUncopiedProject")
  implements NurturingUncopiedProjectRepository
{
  static create({
    prisma,
  }: Readonly<{
    prisma: NurturingUncopiedProjectDatabase;
  }>): PrismaNurturingUncopiedProjectRepository {
    return new PrismaNurturingUncopiedProjectRepository(prisma);
  }

  private constructor(prisma: NurturingUncopiedProjectDatabase) {
    super(prisma);
  }

  async firstSeenAt({
    projectId,
    seenAt,
  }: Readonly<{ projectId: string; seenAt: number }>): Promise<number> {
    // ON CONFLICT DO NOTHING: a concurrent first sighting keeps the row another worker wrote.
    await this.prisma.nurturingUncopiedProject.createMany({
      data: [{ projectId, firstSeenAt: new Date(seenAt) }],
      skipDuplicates: true,
    });
    const row = await this.prisma.nurturingUncopiedProject.findUnique({
      where: { projectId },
      select: { firstSeenAt: true },
    });
    // Forgotten between the two statements: its copy landed, so this sighting is the first.
    return row?.firstSeenAt.getTime() ?? seenAt;
  }

  async forget({ projectId }: Readonly<{ projectId: string }>): Promise<void> {
    await this.prisma.nurturingUncopiedProject.deleteMany({ where: { projectId } });
  }
}
