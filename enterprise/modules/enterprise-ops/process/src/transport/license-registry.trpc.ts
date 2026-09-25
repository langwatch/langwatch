// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The server half of the license registry (ADR-156), gated inside the
 * application the same not-found way as every other Backoffice resource, as main did.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { EnterpriseOpsApi, licenseRegistryTrpc } from "@langwatch/enterprise-ops-contract";

import {
  operatorFact,
  STAFF_LIST,
  STAFF_LIST_FOR_ORGANIZATION,
} from "./enterprise-ops-operator.trpc.ts";

export const licenseRegistryTrpcTransport = defineTrpcRouter(EnterpriseOpsApi, licenseRegistryTrpc)
  .procedure("getAll")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.listIssuedLicenses({ ...input, operator }))

  .procedure("getById")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.getIssuedLicense({ ...input, operator }))

  .procedure("issue")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.issueLicense({ ...input, operator }))

  .procedure("registerLegacy")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST_FOR_ORGANIZATION)
  .handle(({ app, input }, operator) => app.registerLegacyLicense({ ...input, operator }))

  .procedure("revoke")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.revokeIssuedLicense({ ...input, operator }))

  .procedure("reissue")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.reissueLicense({ ...input, operator }))

  .procedure("changeSeats")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.changeLicenseSeats({ ...input, operator }))

  .procedure("resetInstanceBinding")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.resetLicenseInstanceBinding({ ...input, operator }))

  .procedure("updateTerms")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.updateLicenseTerms({ ...input, operator }))

  .procedure("linkToOrganization")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST_FOR_ORGANIZATION)
  .handle(({ app, input }, operator) => app.linkLicenseToOrganization({ ...input, operator }))

  .procedure("activationCodes")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST_FOR_ORGANIZATION)
  .handle(({ app, input }, operator) => app.listActivationCodes({ ...input, operator }))

  .procedure("issueActivationCode")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST_FOR_ORGANIZATION)
  .handle(({ app, input }, operator) => app.issueActivationCode({ ...input, operator }))

  .procedure("revokeActivationCode")
  .withFacts(operatorFact)
  .noPermission(STAFF_LIST)
  .handle(({ app, input }, operator) => app.revokeActivationCode({ ...input, operator }))
  .build();
