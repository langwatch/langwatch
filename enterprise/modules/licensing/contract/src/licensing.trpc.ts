/**
 * Every `license.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the settings page has always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  licenseGeneratedSchema,
  licenseRemovedSchema,
  licenseStatusSchema,
  licenseUploadedSchema,
  ssoGateStatusSchema,
} from "./license.ts";
import { mintLicenseKeyInputSchema, storeLicenseInputSchema } from "./license.commands.ts";
import { licenseOrganizationQuerySchema } from "./license.queries.ts";

export const licenseTrpc = defineTrpcContract("license")
  .query("getStatus")
  .withInput(licenseOrganizationQuerySchema)
  .withOutput(licenseStatusSchema)

  // Why a deployment configured for single sign-on is not using it. The public
  // environment cannot answer it: it reports "email" for an unlicensed
  // deployment, a misconfigured one and one that never wanted federation alike.
  .query("getSsoGateStatus")
  .withInput(z.object({}))
  .withOutput(ssoGateStatusSchema)

  .mutation("upload")
  .withInput(storeLicenseInputSchema)
  .withOutput(licenseUploadedSchema)

  .mutation("remove")
  .withInput(licenseOrganizationQuerySchema)
  .withOutput(licenseRemovedSchema)

  .mutation("generate")
  .withInput(mintLicenseKeyInputSchema)
  .withOutput(licenseGeneratedSchema)
  .build();
