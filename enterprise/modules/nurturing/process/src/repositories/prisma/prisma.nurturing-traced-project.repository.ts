// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository, type PrismaRepositoryClient } from "@langwatch/prisma-client";

import type {
  NurturingTracedProjectRepository,
  NurturingTracedProjectRow,
} from "../nurturing-traced-project.repository.ts";

type NurturingTracedProjectDatabase = PrismaRepositoryClient<readonly ["NurturingTracedProject"]>;

/** Nurturing's `NurturingTracedProject`: each project that received a real trace, once. */
export class PrismaNurturingTracedProjectRepository
  extends PrismaRepository.for("NurturingTracedProject")
  implements NurturingTracedProjectRepository
{
  static create({
    prisma,
  }: Readonly<{ prisma: NurturingTracedProjectDatabase }>): PrismaNurturingTracedProjectRepository {
    return new PrismaNurturingTracedProjectRepository(prisma);
  }

  private constructor(prisma: NurturingTracedProjectDatabase) {
    super(prisma);
  }

  async recordTraced(input: NurturingTracedProjectRow): Promise<void> {
    // ON CONFLICT DO NOTHING: a redelivery or a concurrent record never raises a P2002.
    await this.prisma.nurturingTracedProject.createMany({
      data: [{ ...input }],
      skipDuplicates: true,
    });
  }

  async hasTraced({ organizationId }: Readonly<{ organizationId: string }>): Promise<boolean> {
    const row = await this.prisma.nurturingTracedProject.findFirst({ where: { organizationId } });
    return row !== null;
  }
}
