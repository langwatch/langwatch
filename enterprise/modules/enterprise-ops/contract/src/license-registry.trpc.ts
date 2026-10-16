// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  activationCodePageSchema,
  activationCodeViewSchema,
  issueActivationCodeInputSchema,
  issuedActivationCodeSchema,
  listActivationCodesInputSchema,
  revokeActivationCodeInputSchema,
  changeLicenseSeatsInputSchema,
  issuedLicenseViewSchema,
  issueLicenseInputSchema,
  licenseIdInputSchema,
  linkLicenseToOrganizationInputSchema,
  listIssuedLicensesInputSchema,
  registerLegacyLicenseInputSchema,
  reissueLicenseInputSchema,
  revokeIssuedLicenseInputSchema,
  seatChangeResultSchema,
  signedIssuedLicenseSchema,
  updateLicenseTermsInputSchema,
  listSelfHostedInstancesInputSchema,
  selfHostedInstanceDetailSchema,
  selfHostedInstanceIdInputSchema,
  selfHostedInstancePageSchema,
  createTestingLicenseServiceTokenInputSchema,
  listTestingLicenseTokensInputSchema,
  mintedTestingLicenseTokenSchema,
  revokeTestingLicenseTokenInputSchema,
  testingLicenseTokenViewSchema,
} from "@langwatch/enterprise-licensing-contract";
/**
 * The license registry surface (ADR-156), as the admin console reads and writes
 * it: every issue path writes a row here, so a signed license is shown
 * exactly once, when it is issued or reissued, and never read back.
 */
import { defineTrpcContract } from "@langwatch/module";

import {
  namedIssuedLicensePageSchema,
  namedIssuedLicenseViewSchema,
  namedTestingLicenseTokenPageSchema,
} from "./license-registry.responses.ts";

export const licenseRegistryTrpc = defineTrpcContract("licenseRegistry")
  .query("getAll")
  .withInput(listIssuedLicensesInputSchema)
  .withOutput(namedIssuedLicensePageSchema)

  .query("getById")
  .withInput(licenseIdInputSchema)
  .withOutput(namedIssuedLicenseViewSchema)

  .mutation("issue")
  .withInput(issueLicenseInputSchema)
  .withOutput(signedIssuedLicenseSchema)

  .mutation("registerLegacy")
  .withInput(registerLegacyLicenseInputSchema)
  .withOutput(issuedLicenseViewSchema)

  .mutation("revoke")
  .withInput(revokeIssuedLicenseInputSchema)
  .withOutput(issuedLicenseViewSchema)

  .mutation("reissue")
  .withInput(reissueLicenseInputSchema)
  .withOutput(signedIssuedLicenseSchema)

  .mutation("changeSeats")
  .withInput(changeLicenseSeatsInputSchema)
  .withOutput(seatChangeResultSchema)

  .mutation("resetInstanceBinding")
  .withInput(licenseIdInputSchema)
  .withOutput(issuedLicenseViewSchema)

  .mutation("updateTerms")
  .withInput(updateLicenseTermsInputSchema)
  .withOutput(issuedLicenseViewSchema)

  .mutation("linkToOrganization")
  .withInput(linkLicenseToOrganizationInputSchema)
  .withOutput(issuedLicenseViewSchema)

  .query("activationCodes")
  .withInput(listActivationCodesInputSchema)
  .withOutput(activationCodePageSchema)

  .mutation("issueActivationCode")
  .withInput(issueActivationCodeInputSchema)
  .withOutput(issuedActivationCodeSchema)

  .mutation("revokeActivationCode")
  .withInput(revokeActivationCodeInputSchema)
  .withOutput(activationCodeViewSchema)

  .query("testingLicenseTokens")
  .withInput(listTestingLicenseTokensInputSchema)
  .withOutput(namedTestingLicenseTokenPageSchema)

  .mutation("createTestingLicenseServiceToken")
  .withInput(createTestingLicenseServiceTokenInputSchema)
  .withOutput(mintedTestingLicenseTokenSchema)

  .mutation("revokeTestingLicenseToken")
  .withInput(revokeTestingLicenseTokenInputSchema)
  .withOutput(testingLicenseTokenViewSchema)
  .build();

/** The registry of self-hosted installs (ADR-156 §10), as the admin console
 * reads it. Read only: an install reported every number here. */

export const selfHostedInstancesTrpc = defineTrpcContract("selfHostedInstances")
  .query("getAll")
  .withInput(listSelfHostedInstancesInputSchema)
  .withOutput(selfHostedInstancePageSchema)

  .query("getById")
  .withInput(selfHostedInstanceIdInputSchema)
  .withOutput(selfHostedInstanceDetailSchema)
  .build();
