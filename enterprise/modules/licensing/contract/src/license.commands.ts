import { generatableLimitsShape } from "@langwatch/plans";
import { z } from "zod";

import { licenseDataSchema } from "./license.ts";

export const storeLicenseInputSchema = z.object({
  organizationId: z.string().min(1),
  licenseKey: z.string().min(1),
});
export type StoreLicenseInput = z.infer<typeof storeLicenseInputSchema>;

export const removeLicenseInputSchema = z.object({
  organizationId: z.string().min(1),
});
export type RemoveLicenseInput = z.infer<typeof removeLicenseInputSchema>;

export const generateLicenseInputSchema = z.object({
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
export type GenerateLicenseInput = z.infer<typeof generateLicenseInputSchema>;

/** What a caller asks licensing to sign: licensing signs with its own key. */
export const generateLicenseKeyInputSchema = generateLicenseInputSchema.omit({ privateKey: true });
export type GenerateLicenseKeyInput = z.infer<typeof generateLicenseKeyInputSchema>;

export const generateLicenseOutputSchema = z.object({
  licenseKey: z.string().min(1),
  licenseData: licenseDataSchema,
});
export type GenerateLicenseOutput = z.infer<typeof generateLicenseOutputSchema>;
