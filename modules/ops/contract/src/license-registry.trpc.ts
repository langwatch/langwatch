/**
 * The license registry surface (ADR-156), as the Backoffice reads and writes
 * it: every issue path writes a row here, so a signed license is shown
 * exactly once, when it is issued or reissued, and never read back.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  activationCodePageSchema,
  activationCodeViewSchema,
  issueActivationCodeInputSchema,
  issuedActivationCodeSchema,
  listActivationCodesInputSchema,
  revokeActivationCodeInputSchema,
} from "./activation-code.ts";
import {
  changeLicenseSeatsInputSchema,
  issuedLicensePageSchema,
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
} from "./license-registry.ts";

export const licenseRegistryTrpc = defineTrpcContract("licenseRegistry")
  .query("getAll")
  .withInput(listIssuedLicensesInputSchema)
  .withOutput(issuedLicensePageSchema)

  .query("getById")
  .withInput(licenseIdInputSchema)
  .withOutput(issuedLicenseViewSchema)

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
  .build();
