import { defineServerModule } from "@langwatch/kernel";
import { LicensingApp } from "./app/licensing.app.ts";
import type { OrganizationLicense } from "./app/licensing.members.ts";
import {
  PrismaOrganizationLicenseRepository,
  type OrganizationLicenseDatabase,
} from "./repositories/prisma/prisma.organization-license.repository.ts";
import { LicensingEntitlementSourceAdapter } from "./services/licensing-entitlement-source.service.ts";
import { NodeLicenseCryptographyAdapter } from "./services/node-license-cryptography.service.ts";
import { licenseEnforcementTrpcTransport } from "./transport/license-enforcement.trpc.ts";
import { licenseTrpcTransport } from "./transport/licensing.trpc.ts";

export type { LicensingInfrastructure, LicensingRuntime } from "./app/licensing.app.ts";

export const licensingServer = defineServerModule("licensing")
  .withApp(LicensingApp)
  .withTransports(licenseTrpcTransport, licenseEnforcementTrpcTransport);

/** The licence rows this deployment stores, over its own connection. */
export function createOrganizationLicenses(
  database: OrganizationLicenseDatabase,
): OrganizationLicense {
  return PrismaOrganizationLicenseRepository.create(database);
}

/**
 * Builds the signed-license source from the process-owned license repository.
 * The composition seam constructs the repository; the source service only
 * receives its repository contract.
 */
export function createActivatedLicenseSource(options: {
  prisma: OrganizationLicenseDatabase;
  licensePublicKey?: string;
  isSaas: boolean;
}): LicensingEntitlementSourceAdapter {
  return createDeploymentEntitlementSource({
    licenses: createOrganizationLicenses(options.prisma),
    licensePublicKey: options.licensePublicKey,
    isSaas: options.isSaas,
  });
}

/**
 * The signed-licence leg of plan resolution, over the licence rows this
 * deployment stores and the public key it verifies with.
 */
export function createDeploymentEntitlementSource(options: {
  licenses: OrganizationLicense;
  licensePublicKey?: string;
  isSaas: boolean;
}): LicensingEntitlementSourceAdapter {
  return LicensingEntitlementSourceAdapter.forDeployment({
    licenses: options.licenses,
    cryptography: NodeLicenseCryptographyAdapter.create(
      options.licensePublicKey ? { publicKey: options.licensePublicKey } : {},
    ),
    isSaas: options.isSaas,
  });
}
