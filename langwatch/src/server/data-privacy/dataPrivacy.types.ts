import { z } from "zod";

/**
 * Canonical contract for the unified data-privacy policy (ADR-021).
 *
 * A policy row carries a `DataPrivacyConfig` JSON blob covering four concerns:
 * per-category content disposition (+ restrict audience), the PII level, secrets
 * redaction, and extra attribute keys to drop. Every field is optional in the
 * stored config — an absent field means "inherit from the next scope up". The
 * resolver (`resolveDataPrivacy`) merges the cascade per field into a fully
 * populated `ResolvedDataPrivacy`.
 */

export const CONTENT_CATEGORIES = ["input", "output", "system", "tools"] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

export const DISPOSITIONS = ["capture", "restrict", "drop"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const PII_LEVELS = ["disabled", "essential", "strict"] as const;
export type PiiLevel = (typeof PII_LEVELS)[number];

/**
 * Who may read a `restrict`-ed category. Built on the forward access model, NOT
 * the legacy OrganizationUserRole/TeamUserRole enums: `admins` = passes the team/
 * org admin check, `allMembers` = has team access, plus real Groups + Departments.
 * Everything false/empty = "no one" (fully hidden).
 */
export const audienceSchema = z
  .object({
    admins: z.boolean().optional(),
    allMembers: z.boolean().optional(),
    groupIds: z.array(z.string()).optional(),
    departmentIds: z.array(z.string()).optional(),
  })
  .strict();
export type Audience = z.infer<typeof audienceSchema>;

export const categorySettingSchema = z
  .object({
    disposition: z.enum(DISPOSITIONS),
    // Only meaningful when disposition === "restrict".
    audience: audienceSchema.optional(),
  })
  .strict();
export type CategorySetting = z.infer<typeof categorySettingSchema>;

export const dataPrivacyConfigSchema = z
  .object({
    categories: z
      .object({
        input: categorySettingSchema.optional(),
        output: categorySettingSchema.optional(),
        system: categorySettingSchema.optional(),
        tools: categorySettingSchema.optional(),
      })
      .strict()
      .optional(),
    pii: z.object({ level: z.enum(PII_LEVELS) }).strict().optional(),
    secrets: z
      .object({
        enabled: z.boolean(),
        // Extra regex patterns; unioned down the cascade. Each is safe-regex
        // validated at the service layer before write (guards against ReDoS).
        customPatterns: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    // Extra attribute keys to drop on top of the built-in catalog; unioned down
    // the cascade.
    customDropKeys: z.array(z.string()).optional(),
  })
  .strict();
export type DataPrivacyConfig = z.infer<typeof dataPrivacyConfigSchema>;

// ─── Resolved shape (every field populated) ──────────────────────────────────

export interface ResolvedAudience {
  admins: boolean;
  allMembers: boolean;
  groupIds: string[];
  departmentIds: string[];
}

export interface ResolvedCategory {
  disposition: Disposition;
  audience: ResolvedAudience;
}

export interface ResolvedDataPrivacy {
  categories: Record<ContentCategory, ResolvedCategory>;
  pii: { level: PiiLevel };
  secrets: { enabled: boolean; customPatterns: string[] };
  customDropKeys: string[];
}

export const EMPTY_AUDIENCE: ResolvedAudience = {
  admins: false,
  allMembers: false,
  groupIds: [],
  departmentIds: [],
};

/**
 * Platform defaults applied when no rule sets a field anywhere in the cascade:
 * content captured + visible to the whole team, essential PII, secrets redacted.
 * Privacy is therefore default-on for secrets and PII.
 */
export const PLATFORM_DEFAULT_DATA_PRIVACY: ResolvedDataPrivacy = {
  categories: {
    input: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    output: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    system: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    tools: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
  },
  pii: { level: "essential" },
  secrets: { enabled: true, customPatterns: [] },
  customDropKeys: [],
};

export function resolveAudience(audience?: Audience): ResolvedAudience {
  return {
    admins: audience?.admins ?? false,
    allMembers: audience?.allMembers ?? false,
    groupIds: audience?.groupIds ?? [],
    departmentIds: audience?.departmentIds ?? [],
  };
}
