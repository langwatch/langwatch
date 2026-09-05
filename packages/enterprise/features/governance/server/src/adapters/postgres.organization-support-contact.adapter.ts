// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { OrganizationSupportContactRepository } from "../repositories/organization-support-contact.repository";
import { PrismaOrganizationSupportContactRepository } from "../repositories/prisma/prisma.organization-support-contact.repository";

/** The Postgres seam behind "contact your admin". */
export class PostgresOrganizationSupportContactAdapter {
  private constructor() {}

  static create({ database }: { database: PrismaClient }): OrganizationSupportContactRepository {
    return PrismaOrganizationSupportContactRepository.create({ prisma: database });
  }
}
