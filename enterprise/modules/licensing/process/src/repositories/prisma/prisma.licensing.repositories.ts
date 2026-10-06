import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { LicensingRepositories } from "../licensing.repositories.ts";
import { PrismaActivationCodeRepository } from "./prisma.activation-code.repository.ts";
import { PrismaConnectOrganizationRepository } from "./prisma.connect-organization.repository.ts";
import { PrismaInstanceIdentityRepository } from "./prisma.instance-identity.repository.ts";
import {
  type IssuedLicenseCipher,
  PrismaIssuedLicenseRepository,
} from "./prisma.issued-license.repository.ts";
import { PrismaOrganizationLicenseRepository } from "./prisma.organization-license.repository.ts";
import { PrismaSelfHostedInstanceRepository } from "./prisma.self-hosted-instance.repository.ts";

/** Licensing's Postgres rows; a reissued license waits sealed through the deployment's cipher. */
export class PostgresLicensingRepositories {
  static create({
    prisma,
    encryption,
  }: Readonly<{
    prisma: PrismaClient;
    encryption: IssuedLicenseCipher;
  }>): Omit<LicensingRepositories, "rateLimits"> {
    return {
      organizationLicenses: PrismaOrganizationLicenseRepository.create(prisma),
      issuedLicenses: PrismaIssuedLicenseRepository.create(prisma, encryption),
      activationCodes: PrismaActivationCodeRepository.create(prisma),
      selfHostedInstances: PrismaSelfHostedInstanceRepository.create(prisma),
      connectOrganizations: PrismaConnectOrganizationRepository.create(prisma),
      instanceIdentity: PrismaInstanceIdentityRepository.create(prisma),
    };
  }
}
