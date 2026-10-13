import type { Named } from "@langwatch/module";
import { generatableLimitsShape } from "@langwatch/plans";
import { z } from "zod";

import { licenseDataSchema } from "./license.ts";

const storeLicenseInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
  licenseKey: z.string().min(1),
});
export interface StoreLicenseInputSchema extends Named<typeof storeLicenseInputSchemaDefinition> {}
export const storeLicenseInputSchema: StoreLicenseInputSchema = storeLicenseInputSchemaDefinition;
export type StoreLicenseInput = z.infer<typeof storeLicenseInputSchema>;

const removeLicenseInputSchemaDefinition = z.object({
  organizationId: z.string().min(1),
});
export interface RemoveLicenseInputSchema extends Named<
  typeof removeLicenseInputSchemaDefinition
> {}
export const removeLicenseInputSchema: RemoveLicenseInputSchema =
  removeLicenseInputSchemaDefinition;
export type RemoveLicenseInput = z.infer<typeof removeLicenseInputSchema>;

const generateLicenseInputSchemaDefinition = z.object({
  /** Binds the minted key to one organization; omitted only by legacy callers. */
  organizationId: z.string().optional(),
  organizationName: z.string(),
  email: z.email(),
  planType: z.string().min(1),
  ...generatableLimitsShape,
  expiresAt: z.date().optional(),
  /** Signed into the license so an install reads its entitlement offline. */
  connectServices: z.array(z.string()).optional(),
  privateKey: z.string().min(1),
  now: z.date().optional(),
});
export interface GenerateLicenseInputSchema extends Named<
  typeof generateLicenseInputSchemaDefinition
> {}
export const generateLicenseInputSchema: GenerateLicenseInputSchema =
  generateLicenseInputSchemaDefinition;
export type GenerateLicenseInput = z.infer<typeof generateLicenseInputSchema>;

/** What a caller asks licensing to sign: licensing signs with its own key. */
const generateLicenseKeyInputSchemaDefinition = generateLicenseInputSchema.omit({
  privateKey: true,
});
export interface GenerateLicenseKeyInputSchema extends Named<
  typeof generateLicenseKeyInputSchemaDefinition
> {}
export const generateLicenseKeyInputSchema: GenerateLicenseKeyInputSchema =
  generateLicenseKeyInputSchemaDefinition;
export type GenerateLicenseKeyInput = z.infer<typeof generateLicenseKeyInputSchema>;

const generateLicenseOutputSchemaDefinition = z.object({
  licenseKey: z.string().min(1),
  licenseData: licenseDataSchema,
});
export interface GenerateLicenseOutputSchema extends Named<
  typeof generateLicenseOutputSchemaDefinition
> {}
export const generateLicenseOutputSchema: GenerateLicenseOutputSchema =
  generateLicenseOutputSchemaDefinition;
export type GenerateLicenseOutput = z.infer<typeof generateLicenseOutputSchema>;
