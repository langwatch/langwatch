/**
 * The one place that builds the license registry, the credential service and
 * the license sync as the app uses them: Prisma, the server's signing key, real
 * encryption, and the customer's contract budget (ADR-141).
 */

import { SYSTEM_ACTORS } from "@langwatch/actor";
import { env } from "~/env.mjs";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { rateLimit } from "~/server/rateLimit";
import { decrypt, encrypt } from "~/utils/encryption";
import { createSeatChangeBilling } from "../../billing/connected/seatChange.prisma";
import { PrismaActivationCodes } from "../activation/activationCode.prisma";
import { ActivationCodeService } from "../activation/activationCode.service";
import { createContractBudgetService } from "../connect/connect.prisma";
import { PUBLIC_KEY } from "../constants";
import { ConnectCredentialService } from "./connectCredential.service";
import { PrismaConnectManagedKeys } from "./connectManagedKey.prisma";
import {
  PrismaCustomerOrganizations,
  PrismaIssuedLicenseRepository,
} from "./issuedLicense.prisma";
import { LicenseRegistryService } from "./licenseRegistry.service";
import { LicenseSyncService } from "./licenseSync.service";

/**
 * A connected install syncs once a day. Two a day is already a restart loop,
 * and 48 leaves room for one every half hour before anything is refused.
 */
const SYNCS_PER_DAY = 48;
const ONE_DAY_SECONDS = 24 * 60 * 60;

/**
 * The key licenses are signed with, read on every call so a rotated
 * secret needs no rebuild of the service. `process.env` comes first because
 * `env` captured its value when the module was first imported.
 */
const licenseSigningKey = (): string | undefined =>
  process.env.LANGWATCH_LICENSE_PRIVATE_KEY ??
  env.LANGWATCH_LICENSE_PRIVATE_KEY;

export function createLicenseRegistryService(
  prisma: PrismaClient,
): LicenseRegistryService {
  return new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    organizations: new PrismaCustomerOrganizations(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    contractBudgets: createContractBudgetService(prisma),
    seatBilling: createSeatChangeBilling(prisma),
    signingKey: licenseSigningKey,
    publicKey: PUBLIC_KEY,
    encrypt,
  });
}

/**
 * The registry restricted to recording a license, inside the caller's
 * transaction, so the row and whatever the caller writes beside it land
 * together. `record` reaches only the repository; the managed key and the
 * contract budget need a full client, and calling them here is a mistake the
 * stubs name rather than a silent no-op.
 */
export function createLicenseRecorderService(
  tx: Prisma.TransactionClient,
): LicenseRegistryService {
  const outOfScope = () => {
    throw new Error("recording a license reaches no managed key or budget");
  };
  return new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(tx),
    organizations: new PrismaCustomerOrganizations(tx),
    managedKeys: {
      provision: outOfScope,
      retire: outOfScope,
      invalidate: outOfScope,
    },
    contractBudgets: { sync: outOfScope },
    seatBilling: { invoiceAddedSeats: outOfScope },
    signingKey: licenseSigningKey,
    publicKey: PUBLIC_KEY,
    encrypt,
  });
}

/**
 * Guessing bound: an activation code is eighty bits, so the limit is not what
 * stops a search, but it is what stops one costing us anything. Generous for a
 * customer typing a code in wrong twice.
 */
const ACTIVATION_ATTEMPTS_PER_HOUR = 10;
const ONE_HOUR_SECONDS = 60 * 60;

/** What `POST /api/connect/v1/license/activate` calls. */
export function createActivationCodeService(
  prisma: PrismaClient,
): ActivationCodeService {
  return new ActivationCodeService({
    repository: new PrismaActivationCodes(prisma),
    licenses: createLicenseRegistryService(prisma),
    rateLimit: {
      allow: async ({ codeHash }) =>
        (
          await rateLimit({
            key: `activation_code:${codeHash}`,
            windowSeconds: ONE_HOUR_SECONDS,
            max: ACTIVATION_ATTEMPTS_PER_HOUR,
          })
        ).allowed,
    },
    systemActorId: SYSTEM_ACTORS.connectLicense,
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

/** What `POST /api/connect/v1/license/sync` calls. */
export function createLicenseSyncService(
  prisma: PrismaClient,
): LicenseSyncService {
  return new LicenseSyncService({
    credentials: createConnectCredentialService(prisma),
    repository: new PrismaIssuedLicenseRepository(prisma),
    managedKeys: new PrismaConnectManagedKeys(prisma),
    rateLimit: {
      allow: async ({ licenseRowId }) =>
        (
          await rateLimit({
            key: `license_sync:${licenseRowId}`,
            windowSeconds: ONE_DAY_SECONDS,
            max: SYNCS_PER_DAY,
          })
        ).allowed,
    },
    decrypt,
    systemActorId: SYSTEM_ACTORS.connectLicense,
  });
}
