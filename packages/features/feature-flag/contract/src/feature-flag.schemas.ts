import { z } from "zod";
import type { Instant } from "@langwatch/time";
import {
  experimentTenantPolicySchema,
  experimentTenantScopeSchema,
} from "./feature-flag-experiment.ts";
import { featureFlagRulesSchema, type FeatureFlagRules } from "./feature-flag-rules.ts";
import { authenticatedFeatureFlagTargetInputSchema } from "./feature-flag-target.ts";
import { frontendFeatureFlagSchema, type FrontendFeatureFlag } from "./frontend-feature-flags.ts";

/** One operator-written row, as the operator surfaces read it back. */
export interface StoredFeatureFlag {
  key: string;
  enabled: boolean;
  rules: FeatureFlagRules;
  lastEditedBy: string | null;
  updatedAt: Instant;
}

/** Every browser-visible flag, resolved for one target. */
export type FrontendFeatureFlagMap = Record<FrontendFeatureFlag, boolean>;

export interface FeatureFlagWrite {
  key: string;
  lastEditedBy: string | null;
}

export const operatorFeatureFlagSchema = z
  .object({
    key: z.string(),
    scope: z.enum(["SYSTEM", "PRODUCT"]),
    defaultValue: z.boolean(),
    description: z.string(),
    family: z.string().nullable(),
    storedValue: z.boolean().nullable(),
    rules: featureFlagRulesSchema,
    envOverride: z.boolean().nullable(),
    effective: z.boolean(),
    lastEditedBy: z.string().nullable(),
    updatedAt: z.date().nullable(),
  })
  .strict();

export const operatorFeatureFlagFamilySchema = z
  .object({
    family: z.string(),
    keyPrefix: z.string(),
    scope: z.enum(["SYSTEM", "PRODUCT"]),
    defaultValue: z.boolean(),
    description: z.string(),
  })
  .strict();

export const operatorFeatureFlagCatalogueSchema = z
  .object({
    flags: z.array(operatorFeatureFlagSchema),
    families: z.array(operatorFeatureFlagFamilySchema),
  })
  .strict();

export type OperatorFeatureFlag = z.infer<typeof operatorFeatureFlagSchema>;
export type OperatorFeatureFlagFamily = z.infer<typeof operatorFeatureFlagFamilySchema>;
export type OperatorFeatureFlagCatalogue = z.infer<typeof operatorFeatureFlagCatalogueSchema>;

export const featureFlagReadInputSchema = z
  .object({
    flag: frontendFeatureFlagSchema,
    // `nullish`, not `optional`: #7588 made every flag read state its project
    // and organization, and `null` is how a caller says "targeted at neither"
    // rather than "I forgot to say". `useFeatureFlag`'s `toWireTargetId` sends
    // exactly that, so narrowing this to `optional` alone made the app's own
    // hook stop typechecking against the procedure it calls.
    projectId: z.string().nullish(),
    organizationId: z.string().nullish(),
  })
  .strict();

export const organizationFeatureFlagsInputSchema = z
  .object({
    flag: frontendFeatureFlagSchema,
    organizationIds: z.array(z.string()),
  })
  .strict();

export const featureFlagTargetRequestSchema = z
  .object({ target: authenticatedFeatureFlagTargetInputSchema })
  .strict();

export const experimentEnrolmentInputSchema = z
  .object({
    flag: frontendFeatureFlagSchema,
    target: authenticatedFeatureFlagTargetInputSchema,
    enrolled: z.boolean(),
  })
  .strict();

export const experimentTenantPolicyInputSchema = z
  .object({
    flag: frontendFeatureFlagSchema,
    scope: experimentTenantScopeSchema,
    policy: experimentTenantPolicySchema,
  })
  .strict();

/**
 * The signed-in person a request is authorized as. It is the session's own
 * identifier, never a field of the request body.
 */
export type FeatureFlagCaller = Readonly<{ userId: string }>;

export type FeatureFlagReadForCaller = z.infer<typeof featureFlagReadInputSchema> &
  FeatureFlagCaller;
export type OrganizationFeatureFlagsForCaller = z.infer<
  typeof organizationFeatureFlagsInputSchema
> &
  FeatureFlagCaller;
export type FeatureFlagTargetRequestForCaller = z.infer<typeof featureFlagTargetRequestSchema> &
  FeatureFlagCaller;
export type ExperimentEnrolmentForCaller = z.infer<typeof experimentEnrolmentInputSchema> &
  FeatureFlagCaller;
export type ExperimentTenantPolicyForCaller = z.infer<typeof experimentTenantPolicyInputSchema> &
  FeatureFlagCaller;
