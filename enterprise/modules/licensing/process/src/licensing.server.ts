import { defineServerModule } from "@langwatch/kernel";

import { LicensingApp } from "./app/licensing.app.ts";
import type { LicensingInfrastructure } from "./app/licensing.app.ts";
import type { OrganizationLicenseDatabase } from "./repositories/prisma/prisma.organization-license.repository.ts";
import { createOrganizationLicenses } from "./services/licensing-infrastructure.service.ts";
import { LicensingEntitlementSourceAdapter } from "./services/licensing-entitlement-source.service.ts";
import { NodeLicenseCryptographyAdapter } from "./services/node-license-cryptography.service.ts";
import { licenseEnforcementTrpcTransport } from "./transport/license-enforcement.trpc.ts";
import { licenseTrpcTransport } from "./transport/licensing.trpc.ts";

export type { LicensingInfrastructure, LicensingRuntime } from "./app/licensing.app.ts";

export const licensingServer = defineServerModule("licensing")
  .withApp(LicensingApp)
  .withTransports(licenseTrpcTransport, licenseEnforcementTrpcTransport);

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
