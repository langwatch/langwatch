// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GovernanceDirectoryPort } from "../ports/governance-directory.port";
import { PrismaGovernanceDirectoryRepository } from "../repositories/prisma/prisma.governance-directory.repository";

/** The Postgres seam a process composes the governance row reads from. */
export class PostgresGovernanceDirectoryAdapter {
  private constructor() {}

  static create({ database }: { database: PrismaClient }): GovernanceDirectoryPort {
    return PrismaGovernanceDirectoryRepository.create(database);
  }
}
