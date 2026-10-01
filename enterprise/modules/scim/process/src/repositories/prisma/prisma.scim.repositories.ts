// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ScimRepositories } from "../scim.repositories.ts";
import {
  PrismaScimSyncProjectionRepository,
  type ScimOperatorReadsMember,
} from "./prisma.scim-sync-projection.repository.ts";
import { PrismaScimRepository } from "./prisma.scim.repository.ts";

/** SCIM's live store: the Postgres rows the directory writes, and its declared operator read. */
export class PostgresScimRepositories {
  static readonly requires = ["prisma", "operatorReads"] as const;

  static create({
    prisma,
    operatorReads,
  }: { prisma: PrismaClient } & ScimOperatorReadsMember): ScimRepositories {
    return {
      scim: PrismaScimRepository.create(prisma),
      scimSyncs: PrismaScimSyncProjectionRepository.create({ prisma, operatorReads }),
    };
  }
}
