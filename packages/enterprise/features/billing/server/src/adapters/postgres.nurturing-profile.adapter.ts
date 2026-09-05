// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { NurturingProfileRepository } from "../repositories/nurturing-profile.repository";
import { PrismaNurturingProfileRepository } from "../repositories/prisma/prisma.nurturing-profile.repository";

/** The Postgres seam a process registers the lifecycle-signal reads from. */
export class PostgresNurturingProfileAdapter {
  private constructor() {}

  static create({ database }: { database: PrismaClient }): NurturingProfileRepository {
    return PrismaNurturingProfileRepository.create(database);
  }
}
