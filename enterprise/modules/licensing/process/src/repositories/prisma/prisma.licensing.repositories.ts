import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { LicensingRepositories } from "../licensing.repositories.ts";
import { PrismaActivationCodeRepository } from "./prisma.activation-code.repository.ts";
import { PrismaConnectOrganizationRepository } from "./prisma.connect-organization.repository.ts";
import { PrismaInstanceIdentityRepository } from "./prisma.instance-identity.repository.ts";
import {
  type IssuedLicenseCipher,
  PrismaIssuedLicenseRepository,
} from "./prisma.issued-license.repository.ts";
import { PrismaMemberSeatRepository } from "./prisma.member-seat.repository.ts";
import { PrismaOrganizationLicenseRepository } from "./prisma.organization-license.repository.ts";
import { PrismaSelfHostedInstanceRepository } from "./prisma.self-hosted-instance.repository.ts";
import { PrismaSelfHostedNoticeRepository } from "./prisma.self-hosted-notice.repository.ts";
import { PrismaSignInProviderMountRepository } from "./prisma.sign-in-provider-mount.repository.ts";
import { PrismaUpgradeDiagnosticRepository } from "./prisma.upgrade-diagnostic.repository.ts";

/** Licensing's Postgres rows; a reissued license waits sealed through the deployment's cipher. */
export class PostgresLicensingRepositories {
  static create({
    prisma,
    encryption,
  }: Readonly<{
    prisma: PrismaClient;
    encryption: IssuedLicenseCipher;
  }>): Omit<LicensingRepositories, "rateLimits" | "upgradeDiagnosticBundles"> {
    return {
      organizationLicenses: PrismaOrganizationLicenseRepository.create(prisma),
      issuedLicenses: PrismaIssuedLicenseRepository.create(prisma, encryption),
      activationCodes: PrismaActivationCodeRepository.create(prisma),
      selfHostedInstances: PrismaSelfHostedInstanceRepository.create(prisma),
      selfHostedNotices: PrismaSelfHostedNoticeRepository.create(prisma),
      connectOrganizations: PrismaConnectOrganizationRepository.create(prisma),
      instanceIdentity: PrismaInstanceIdentityRepository.create(prisma),
      memberSeats: PrismaMemberSeatRepository.create(prisma),
      signInProviderMounts: PrismaSignInProviderMountRepository.create(prisma),
      upgradeDiagnostics: PrismaUpgradeDiagnosticRepository.create(prisma),
    };
  }
}
