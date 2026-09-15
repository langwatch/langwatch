import { generatableLimitsShape, mintablePlanLimitsSchema } from "@langwatch/plans";
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
  privateKey: z.string().min(1),
  now: z.date().optional(),
});
export type GenerateLicenseInput = z.infer<typeof generateLicenseInputSchema>;

/**
 * What an operator minting a key against one organization supplies. The
 * binding is required here and optional on {@link generateLicenseInputSchema},
 * where only a legacy caller may omit it.
 */
export const mintLicenseKeyInputSchema = z.object({
  organizationId: z.string().min(1),
  privateKey: z.string().min(1, "Private key is required"),
  organizationName: z.string().min(1, "Organization name is required"),
  email: z.string().email("Invalid email format"),
  expiresAt: z.date(),
  planType: z.enum(["PRO", "ENTERPRISE", "CUSTOM"]),
  plan: mintablePlanLimitsSchema,
});
export type MintLicenseKeyInput = z.infer<typeof mintLicenseKeyInputSchema>;

export const generateLicenseOutputSchema = z.object({
  licenseKey: z.string().min(1),
  licenseData: licenseDataSchema,
});
export type GenerateLicenseOutput = z.infer<typeof generateLicenseOutputSchema>;
