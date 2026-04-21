import { z } from "zod";
import type { Attribution } from "~/utils/attribution";

/**
 * Input schema for organization signup data
 */
export const signUpDataSchema = z.object({
  usage: z.string().optional().nullable(),
  solution: z.string().optional().nullable(),
  terms: z.boolean().optional(),
  companyType: z.string().optional().nullable(),
  companySize: z.string().optional().nullable(),
  projectType: z.string().optional().nullable(),
  howDidYouHearAboutUs: z.string().optional().nullable(),
  otherCompanyType: z.string().optional().nullable(),
  otherProjectType: z.string().optional().nullable(),
  otherHowDidYouHearAboutUs: z.string().optional().nullable(),
  utmCampaign: z.string().optional().nullable(),
  yourRole: z.string().optional().nullable(),
  featureUsage: z.string().optional().nullable(),
  // First-touch attribution (from landing URL / document.referrer)
  leadSource: z.string().optional().nullable(),
  utmSource: z.string().optional().nullable(),
  utmMedium: z.string().optional().nullable(),
  utmTerm: z.string().optional().nullable(),
  utmContent: z.string().optional().nullable(),
  referrer: z.string().optional().nullable(),
});

// Compile-time guard: if Attribution gains a field not in signUpDataSchema,
// this type resolves to the missing key(s) instead of `true` and the
// conditional type in the interface below produces a type error.
type _AssertAttributionCovered = [
  Exclude<keyof Attribution, keyof z.infer<typeof signUpDataSchema>>,
] extends [never]
  ? true
  : { error: "Attribution has fields missing from signUpDataSchema" };
