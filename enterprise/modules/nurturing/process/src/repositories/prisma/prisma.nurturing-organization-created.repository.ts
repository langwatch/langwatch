// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingOrganizationCreatedRepository } from "../nurturing-organization-created.repository.ts";

type NurturingOrganizationCreatedDatabase = Pick<
  PrismaClient,
  "nurturingOrganizationCreated" | "$executeRaw"
>;

/** Nurturing's own `NurturingOrganizationCreated` rows, from organization's created event. */
export class PrismaNurturingOrganizationCreatedRepository
  extends PrismaRepository.for("NurturingOrganizationCreated")
  implements NurturingOrganizationCreatedRepository
{
  static create({
    prisma,
  }: Readonly<{
    prisma: NurturingOrganizationCreatedDatabase;
  }>): PrismaNurturingOrganizationCreatedRepository {
    return new PrismaNurturingOrganizationCreatedRepository(prisma);
  }

  readonly #database: NurturingOrganizationCreatedDatabase;

  private constructor(prisma: NurturingOrganizationCreatedDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  async recordOrganizationCreated({
    organizationId,
    createdAt,
  }: Readonly<{ organizationId: string; createdAt: number }>): Promise<void> {
    const at = new Date(createdAt);
    // One statement keeps the earliest: concurrent deliveries never move the time later.
    await this.#database.$executeRaw`
      INSERT INTO "NurturingOrganizationCreated" AS known ("organizationId", "createdAt")
      VALUES (${organizationId}, ${at})
      ON CONFLICT ("organizationId") DO UPDATE
         SET "createdAt" = LEAST(known."createdAt", EXCLUDED."createdAt")
       WHERE known."organizationId" = ${organizationId}
    `;
  }

  async findOrganizationCreatedAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<{ organizationCreatedAt: number | null }> {
    const row = await this.#database.nurturingOrganizationCreated.findUnique({
      where: { organizationId },
      select: { createdAt: true },
    });
    return { organizationCreatedAt: row?.createdAt.getTime() ?? null };
  }
}
