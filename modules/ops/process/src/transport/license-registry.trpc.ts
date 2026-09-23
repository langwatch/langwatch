/**
 * The server half of the license registry (ADR-156), gated inside the
 * application the same not-found way as every other Backoffice resource.
 */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { licenseRegistryTrpc, OpsApi } from "@langwatch/ops-contract";

import { OPS_MANAGE, OPS_VIEW, opsOperatorFact } from "#transport/ops-operator.trpc";

export const licenseRegistryTrpcTransport = defineTrpcRouter(OpsApi, licenseRegistryTrpc)
  .procedure("getAll")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => app.listIssuedLicenses({ ...input, operator }))

  .procedure("getById")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => app.getIssuedLicense({ ...input, operator }))

  .procedure("issue")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.issueLicense({ ...input, operator }))

  .procedure("registerLegacy")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.registerLegacyLicense({ ...input, operator }))

  .procedure("revoke")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.revokeIssuedLicense({ ...input, operator }))

  .procedure("reissue")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.reissueLicense({ ...input, operator }))

  .procedure("changeSeats")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.changeLicenseSeats({ ...input, operator }))

  .procedure("resetInstanceBinding")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.resetLicenseInstanceBinding({ ...input, operator }))

  .procedure("updateTerms")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.updateLicenseTerms({ ...input, operator }))

  .procedure("linkToOrganization")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.linkLicenseToOrganization({ ...input, operator }))

  .procedure("activationCodes")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_VIEW)
  .handle(({ app, input }, operator) => app.listActivationCodes({ ...input, operator }))

  .procedure("issueActivationCode")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.issueActivationCode({ ...input, operator }))

  .procedure("revokeActivationCode")
  .withFacts(opsOperatorFact)
  .serviceAuthorized(OPS_MANAGE)
  .handle(({ app, input }, operator) => app.revokeActivationCode({ ...input, operator }))
  .build();
