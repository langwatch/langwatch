import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { OrganizationLicensePort } from "../ports/organization-license.port";
import { PrismaOrganizationLicenseRepository } from "../repositories/prisma/prisma.organization-license.repository";

/**
 * The composition seam between a process and the licence a plan resolves from.
 *
 * It takes the typed client the composition root already holds and hands back
 * the port, so neither process needs to know a repository class exists — and
 * neither writes the read itself, which is how the interactive and background
 * processes would start disagreeing about whether an organization is licensed.
 */
export class PostgresOrganizationLicenseAdapter {
  static create(prisma: PrismaClient): PostgresOrganizationLicenseAdapter {
    return new PostgresOrganizationLicenseAdapter(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  build(): OrganizationLicensePort {
    return PrismaOrganizationLicenseRepository.create(this.prisma);
  }
}
