import { z } from "zod";
import {
  ATTRIBUTION_FIELDS,
  type AttributionField,
} from "~/utils/attribution";

const attributionShape = ATTRIBUTION_FIELDS.reduce(
  (acc, field) => {
    acc[field] = z.string().optional().nullable();
    return acc;
  },
  {} as Record<
    AttributionField,
    z.ZodNullable<z.ZodOptional<z.ZodString>>
  >,
);

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
  yourRole: z.string().optional().nullable(),
  featureUsage: z.string().optional().nullable(),
  ...attributionShape,
});
