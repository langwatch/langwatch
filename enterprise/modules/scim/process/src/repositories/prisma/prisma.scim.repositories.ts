// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ScimRepositories } from "../scim.repositories.ts";
import { PrismaScimRepository } from "./prisma.scim.repository.ts";

/** SCIM's live store: the Postgres rows the directory writes. */
export class PostgresScimRepositories {
  static readonly requires = ["prisma"] as const;

  static create({ prisma }: { prisma: PrismaClient }): ScimRepositories {
    return { scim: PrismaScimRepository.create(prisma) };
  }
}
