/**
 * The one place that builds the license registry and the credential service as
 * the app uses them: Prisma, the server's signing key, real encryption, and the
 * customer's contract budget (ADR-139).
 */

import { SYSTEM_ACTORS } from "@langwatch/actor";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
import { encrypt } from "~/utils/encryption";
import { createContractBudgetService } from "../connect/connect.prisma";
import { PUBLIC_KEY } from "../constants";
import { ConnectCredentialService } from "./connectCredential.service";
import { PrismaConnectManagedKeys } from "./connectManagedKey.prisma";
import {
  PrismaCustomerOrganizations,
  PrismaIssuedLicenseRepository,
} from "./issuedLicense.prisma";
import { LicenseRegistryService } from "./licenseRegistry.service";

export function createLicenseRegistryService(
  prisma: PrismaClient,
): LicenseRegistryService {
  return new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    organizations: new PrismaCustomerOrganizations(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    contractBudgets: createContractBudgetService(prisma),
    // Read per call, so a rotated secret needs no rebuild of the service.
    signingKey: () => env.LANGWATCH_LICENSE_PRIVATE_KEY,
    publicKey: PUBLIC_KEY,
    encrypt,
  });
}

/** What the gateway's key resolution asks when it is handed a license token. */
export function createConnectCredentialService(
  prisma: PrismaClient,
): ConnectCredentialService {
  return new ConnectCredentialService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    systemActorId: SYSTEM_ACTORS.connectLicense,
  });
}
