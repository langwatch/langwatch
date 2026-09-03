import { REDACTION_MARKER_ENTITIES, SECRET_MARKER_ENTITY } from "@langwatch/redaction";
import { z } from "zod";

export const DATA_PRIVACY_FEATURE_ID = "data-privacy" as const;
export const CONTENT_CATEGORIES = ["input", "output", "system", "tools"] as const;
export type ContentCategory = (typeof CONTENT_CATEGORIES)[number];
export const DISPOSITIONS = ["capture", "restrict", "drop"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];
export const PII_LEVELS = ["disabled", "essential", "strict", "custom"] as const;
export type PiiLevel = (typeof PII_LEVELS)[number];
export const DATA_PRIVACY_SCOPE_TYPES = ["ORGANIZATION", "DEPARTMENT", "TEAM", "PROJECT"] as const;
export type DataPrivacyScopeType = (typeof DATA_PRIVACY_SCOPE_TYPES)[number];

const VALID_PII_ENTITIES = new Set(
  [...REDACTION_MARKER_ENTITIES].filter((entity) => entity !== SECRET_MARKER_ENTITY),
);

export const audienceSchema = z
  .object({
    admins: z.boolean().optional(),
    allMembers: z.boolean().optional(),
    members: z.boolean().optional(),
    viewers: z.boolean().optional(),
    projectOwner: z.boolean().optional(),
    groupIds: z.array(z.string()).optional(),
  })
  .strict();
export type Audience = z.infer<typeof audienceSchema>;

export const categorySettingSchema = z
  .object({ disposition: z.enum(DISPOSITIONS), audience: audienceSchema.optional() })
  .strict();
export type CategorySetting = z.infer<typeof categorySettingSchema>;

export const CUSTOM_ATTRIBUTE_DISPOSITIONS = ["restrict", "drop"] as const;
export type CustomAttributeDisposition = (typeof CUSTOM_ATTRIBUTE_DISPOSITIONS)[number];
export const customAttributeRuleSchema = z
  .object({
    pattern: z.string().trim().min(1).max(256),
    disposition: z.enum(CUSTOM_ATTRIBUTE_DISPOSITIONS),
    audience: audienceSchema.optional(),
  })
  .strict();
export type CustomAttributeRule = z.infer<typeof customAttributeRuleSchema>;

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
    pii: z
      .object({
        level: z.enum(PII_LEVELS),
        entities: z
          .array(
            z.string().refine((entity) => VALID_PII_ENTITIES.has(entity), {
              message: "Unknown PII entity",
            }),
          )
          .max(64)
          .optional(),
        exceptPatterns: z.array(z.string().trim().min(1).max(512)).max(50).optional(),
      })
      .strict()
      .superRefine((pii, ctx) => {
        if (pii.level === "custom" && (!pii.entities || pii.entities.length === 0)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "The custom PII level needs at least one entity",
            path: ["entities"],
          });
        }
        if (pii.level !== "custom" && pii.entities && pii.entities.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Entities can only be set when the level is custom",
            path: ["entities"],
          });
        }
        if (pii.level === "disabled" && pii.exceptPatterns?.length) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Exception patterns need a PII level that redacts something",
            path: ["exceptPatterns"],
          });
        }
      })
      .optional(),
    secrets: z
      .object({ enabled: z.boolean(), customPatterns: z.array(z.string()).optional() })
      .strict()
      .optional(),
    customAttributes: z.array(customAttributeRuleSchema).max(50).optional(),
  })
  .strict();
export type DataPrivacyConfig = z.infer<typeof dataPrivacyConfigSchema>;

export interface ResolvedAudience {
  admins: boolean;
  allMembers: boolean;
  members: boolean;
  viewers: boolean;
  projectOwner: boolean;
  groupIds: string[];
}
export interface ResolvedCategory {
  disposition: Disposition;
  audience: ResolvedAudience;
}
export interface ResolvedCustomAttributeRule {
  pattern: string;
  disposition: CustomAttributeDisposition;
  audience: ResolvedAudience;
}
export interface ResolvedDataPrivacy {
  categories: Record<ContentCategory, ResolvedCategory>;
  pii: { level: PiiLevel; entities: string[]; exceptPatterns: string[] };
  secrets: { enabled: boolean; customPatterns: string[] };
  customAttributes: ResolvedCustomAttributeRule[];
}

export const EMPTY_AUDIENCE: ResolvedAudience = {
  admins: false,
  allMembers: false,
  members: false,
  viewers: false,
  projectOwner: false,
  groupIds: [],
};
export const PLATFORM_DEFAULT_DATA_PRIVACY: ResolvedDataPrivacy = {
  categories: {
    input: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    output: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    system: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
    tools: { disposition: "capture", audience: { ...EMPTY_AUDIENCE } },
  },
  pii: { level: "essential", entities: [], exceptPatterns: [] },
  secrets: { enabled: true, customPatterns: [] },
  customAttributes: [],
};
export function resolveAudience(audience?: Audience): ResolvedAudience {
  return {
    admins: audience?.admins ?? false,
    allMembers: audience?.allMembers ?? false,
    members: audience?.members ?? false,
    viewers: audience?.viewers ?? false,
    projectOwner: audience?.projectOwner ?? false,
    groupIds: audience?.groupIds ?? [],
  };
}

export interface DataPrivacyPolicy {
  id: string;
  organizationId: string;
  scopeType: DataPrivacyScopeType;
  scopeId: string;
  personalOnly: boolean;
  config: DataPrivacyConfig;
  createdAt: Date;
  updatedAt: Date;
}

export const dataPrivacyPolicySchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    scopeType: z.enum(DATA_PRIVACY_SCOPE_TYPES),
    scopeId: z.string().min(1),
    personalOnly: z.boolean(),
    config: dataPrivacyConfigSchema,
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export const dataPrivacyRowSchema = z
  .object({
    scopeType: z.enum(DATA_PRIVACY_SCOPE_TYPES),
    scopeId: z.string().min(1),
    personalOnly: z.boolean(),
    config: dataPrivacyConfigSchema,
  })
  .strict();

export interface DataPrivacyScope {
  scopeType: DataPrivacyScopeType;
  scopeId: string;
}
export interface DataPrivacyScopeFacts {
  organizationId: string;
  teamId: string;
  projectId: string;
  departmentId: string | null;
  isPersonal: boolean;
}
export interface DataPrivacyRow {
  scopeType: DataPrivacyScopeType;
  scopeId: string;
  personalOnly: boolean;
  config: DataPrivacyConfig;
}
