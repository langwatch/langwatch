import { z } from "zod";
import { licenseDataSchema } from "./license";

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
  organizationName: z.string(),
  email: z.email(),
  planType: z.string().min(1),
  maxMembers: z.number(),
  maxMembersLite: z.number().optional(),
  maxMessagesPerMonth: z.number().optional(),
  expiresAt: z.date().optional(),
  privateKey: z.string().min(1),
  now: z.date().optional(),
});
export type GenerateLicenseInput = z.infer<typeof generateLicenseInputSchema>;

export const generateLicenseOutputSchema = z.object({
  licenseKey: z.string().min(1),
  licenseData: licenseDataSchema,
});
export type GenerateLicenseOutput = z.infer<
  typeof generateLicenseOutputSchema
>;
