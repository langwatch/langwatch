// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingProjectPlacement } from "../nurturing-project-directory.repository.ts";
import type { NurturingProjectPlacementRepository } from "../nurturing-project-placement.repository.ts";

type NurturingProjectPlacementDatabase = Pick<PrismaClient, "nurturingProject">;

/** Nurturing's own `NurturingProject` rows: a project's organization, from project's events. */
export class PrismaNurturingProjectPlacementRepository
  extends PrismaRepository.for("NurturingProject")
  implements NurturingProjectPlacementRepository
{
  static create({
    prisma,
  }: Readonly<{
    prisma: NurturingProjectPlacementDatabase;
  }>): PrismaNurturingProjectPlacementRepository {
    return new PrismaNurturingProjectPlacementRepository(prisma);
  }

  readonly #database: NurturingProjectPlacementDatabase;

  private constructor(prisma: NurturingProjectPlacementDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  async recordProject({
    projectId,
    organizationId,
  }: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    await this.#database.nurturingProject.upsert({
      where: { projectId },
      create: { projectId, organizationId },
      update: { organizationId },
    });
  }

  async getPlacement({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingProjectPlacement> {
    const row = await this.#database.nurturingProject.findUnique({
      where: { projectId },
      select: { organizationId: true },
    });
    return row ? { outcome: "known", organizationId: row.organizationId } : { outcome: "unknown" };
  }

  async findProjectIds({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<string[]> {
    const rows = await this.#database.nurturingProject.findMany({
      where: { organizationId },
      select: { projectId: true },
    });
    return rows.map(({ projectId }) => projectId);
  }
}
