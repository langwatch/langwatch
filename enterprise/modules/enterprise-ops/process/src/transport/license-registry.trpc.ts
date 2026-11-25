// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of the license registry (ADR-156): the platform door hides it from non-staff
 * and refuses a write to staff lacking ops:manage (Q42); the cloud-ops capability is the app's.
 */
import {
  defineMiddlewareContext,
  defineTrpcRouter,
  type TrpcRouterDeclaration,
} from "@langwatch/api/trpc";
import { EnterpriseOpsApi, licenseRegistryTrpc } from "@langwatch/enterprise-ops-contract";
import { opsOperatorSchema } from "@langwatch/ops-contract";

/** The signed-in operator, bound by the process under the name ops reads it by. */
export const operatorContext = defineMiddlewareContext("opsOperator", opsOperatorSchema.nullable());

/** Cloud admin staff hold ops:view at the platform; anyone else is answered not-found (Q42). */
export const STAFF = { at: "platform", hiddenWithout: "ops:view" } as const;

export const licenseRegistryTrpcTransport: TrpcRouterDeclaration<
  EnterpriseOpsApi,
  typeof licenseRegistryTrpc
> = defineTrpcRouter(EnterpriseOpsApi, licenseRegistryTrpc)
  .procedure("getAll")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:view", STAFF)
  .handle(({ app, input }, operator) => app.listIssuedLicenses({ ...input, operator }))

  .procedure("getById")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:view", STAFF)
  .handle(({ app, input }, operator) => app.getIssuedLicense({ ...input, operator }))

  .procedure("issue")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.issueLicense({ ...input, operator }))

  .procedure("registerLegacy")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.registerLegacyLicense({ ...input, operator }))

  .procedure("revoke")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.revokeIssuedLicense({ ...input, operator }))

  .procedure("reissue")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.reissueLicense({ ...input, operator }))

  .procedure("changeSeats")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.changeLicenseSeats({ ...input, operator }))

  .procedure("resetInstanceBinding")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.resetLicenseInstanceBinding({ ...input, operator }))

  .procedure("updateTerms")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.updateLicenseTerms({ ...input, operator }))

  .procedure("linkToOrganization")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.linkLicenseToOrganization({ ...input, operator }))

  .procedure("activationCodes")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:view", STAFF)
  .handle(({ app, input }, operator) => app.listActivationCodes({ ...input, operator }))

  .procedure("issueActivationCode")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.issueActivationCode({ ...input, operator }))

  .procedure("revokeActivationCode")
  .withMiddlewareContext(operatorContext)
  .withPermission("ops:manage", STAFF)
  .handle(({ app, input }, operator) => app.revokeActivationCode({ ...input, operator }))
  .build();
