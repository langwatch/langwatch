import type { Named } from "@langwatch/module";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

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

const operatorFeatureFlagSchemaDefinition = z
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
export interface OperatorFeatureFlagSchema extends Named<
  typeof operatorFeatureFlagSchemaDefinition
> {}
export const operatorFeatureFlagSchema: OperatorFeatureFlagSchema =
  operatorFeatureFlagSchemaDefinition;

const operatorFeatureFlagFamilySchemaDefinition = z
  .object({
    family: z.string(),
    keyPrefix: z.string(),
    scope: z.enum(["SYSTEM", "PRODUCT"]),
    defaultValue: z.boolean(),
    description: z.string(),
  })
  .strict();
export interface OperatorFeatureFlagFamilySchema extends Named<
  typeof operatorFeatureFlagFamilySchemaDefinition
> {}
export const operatorFeatureFlagFamilySchema: OperatorFeatureFlagFamilySchema =
  operatorFeatureFlagFamilySchemaDefinition;

const operatorFeatureFlagCatalogueSchemaDefinition = z
  .object({
    flags: z.array(operatorFeatureFlagSchema),
    families: z.array(operatorFeatureFlagFamilySchema),
  })
  .strict();
export interface OperatorFeatureFlagCatalogueSchema extends Named<
  typeof operatorFeatureFlagCatalogueSchemaDefinition
> {}
export const operatorFeatureFlagCatalogueSchema: OperatorFeatureFlagCatalogueSchema =
  operatorFeatureFlagCatalogueSchemaDefinition;

export type OperatorFeatureFlag = z.infer<typeof operatorFeatureFlagSchema>;
export type OperatorFeatureFlagFamily = z.infer<typeof operatorFeatureFlagFamilySchema>;
export type OperatorFeatureFlagCatalogue = z.infer<typeof operatorFeatureFlagCatalogueSchema>;

const featureFlagReadInputSchemaDefinition = z
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
export interface FeatureFlagReadInputSchema extends Named<
  typeof featureFlagReadInputSchemaDefinition
> {}
export const featureFlagReadInputSchema: FeatureFlagReadInputSchema =
  featureFlagReadInputSchemaDefinition;

const organizationFeatureFlagsInputSchemaDefinition = z
  .object({
    flag: frontendFeatureFlagSchema,
    organizationIds: z.array(z.string()),
  })
  .strict();
export interface OrganizationFeatureFlagsInputSchema extends Named<
  typeof organizationFeatureFlagsInputSchemaDefinition
> {}
export const organizationFeatureFlagsInputSchema: OrganizationFeatureFlagsInputSchema =
  organizationFeatureFlagsInputSchemaDefinition;

const featureFlagTargetRequestSchemaDefinition = z
  .object({ target: authenticatedFeatureFlagTargetInputSchema })
  .strict();
export interface FeatureFlagTargetRequestSchema extends Named<
  typeof featureFlagTargetRequestSchemaDefinition
> {}
export const featureFlagTargetRequestSchema: FeatureFlagTargetRequestSchema =
  featureFlagTargetRequestSchemaDefinition;

const experimentEnrolmentInputSchemaDefinition = z
  .object({
    flag: frontendFeatureFlagSchema,
    target: authenticatedFeatureFlagTargetInputSchema,
    enrolled: z.boolean(),
  })
  .strict();
export interface ExperimentEnrolmentInputSchema extends Named<
  typeof experimentEnrolmentInputSchemaDefinition
> {}
export const experimentEnrolmentInputSchema: ExperimentEnrolmentInputSchema =
  experimentEnrolmentInputSchemaDefinition;

const experimentTenantPolicyInputSchemaDefinition = z
  .object({
    flag: frontendFeatureFlagSchema,
    scope: experimentTenantScopeSchema,
    policy: experimentTenantPolicySchema,
  })
  .strict();
export interface ExperimentTenantPolicyInputSchema extends Named<
  typeof experimentTenantPolicyInputSchemaDefinition
> {}
export const experimentTenantPolicyInputSchema: ExperimentTenantPolicyInputSchema =
  experimentTenantPolicyInputSchemaDefinition;

/**
 * The signed-in person a request is authorized as; `userEmail` arrives as a
 * process fact, for an email domain targeting rule (absent without one).
 */
export type FeatureFlagCaller = Readonly<{ userId: string; userEmail?: string }>;

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
