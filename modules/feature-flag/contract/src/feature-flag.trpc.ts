/**
 * Every `featureFlag.*` procedure, declared once. The browser reads the same
 * names and schemas as types; the server binds a permission and a handler to
 * each of them and repeats nothing.
 */

import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { experimentCatalogueEntrySchema } from "./feature-flag-experiment.ts";
import {
  experimentEnrolmentInputSchema,
  experimentTenantPolicyInputSchema,
  featureFlagReadInputSchema,
  featureFlagTargetRequestSchema,
  organizationFeatureFlagsInputSchema,
} from "./feature-flag.schemas.ts";
import { frontendFeatureFlagMapSchema } from "./frontend-feature-flags.ts";

const enabledOutputSchemaDefinition = z.object({ enabled: z.boolean() }).strict();
export interface EnabledOutputSchema extends Named<typeof enabledOutputSchemaDefinition> {}
export const enabledOutputSchema: EnabledOutputSchema = enabledOutputSchemaDefinition;
const enabledByOrganizationOutputSchemaDefinition = z
  .object({ enabledByOrganizationId: z.record(z.string(), z.boolean()) })
  .strict();
export interface EnabledByOrganizationOutputSchema extends Named<
  typeof enabledByOrganizationOutputSchemaDefinition
> {}
export const enabledByOrganizationOutputSchema: EnabledByOrganizationOutputSchema =
  enabledByOrganizationOutputSchemaDefinition;
const resolvedFlagsOutputSchemaDefinition = z
  .object({ flags: frontendFeatureFlagMapSchema })
  .strict();
export interface ResolvedFlagsOutputSchema extends Named<
  typeof resolvedFlagsOutputSchemaDefinition
> {}
export const resolvedFlagsOutputSchema: ResolvedFlagsOutputSchema =
  resolvedFlagsOutputSchemaDefinition;
const experimentsOutputSchemaDefinition = z
  .object({ experiments: z.array(experimentCatalogueEntrySchema) })
  .strict();
export interface ExperimentsOutputSchema extends Named<typeof experimentsOutputSchemaDefinition> {}
export const experimentsOutputSchema: ExperimentsOutputSchema = experimentsOutputSchemaDefinition;
const experimentWriteOutputSchemaDefinition = z.object({ ok: z.literal(true) }).strict();
export interface ExperimentWriteOutputSchema extends Named<
  typeof experimentWriteOutputSchemaDefinition
> {}
export const experimentWriteOutputSchema: ExperimentWriteOutputSchema =
  experimentWriteOutputSchemaDefinition;

export const featureFlagTrpc = defineTrpcContract("featureFlag")
  .query("isEnabled")
  .withInput(featureFlagReadInputSchema)
  .withOutput(enabledOutputSchema)

  /** True when the flag is on for any organization the caller belongs to. */
  .query("isEnabledForAnyOrganization")
  .withInput(organizationFeatureFlagsInputSchema)
  .withOutput(enabledOutputSchema)

  .query("isEnabledForEachOrganization")
  .withInput(organizationFeatureFlagsInputSchema)
  .withOutput(enabledByOrganizationOutputSchema)

  .query("resolve")
  .withInput(featureFlagTargetRequestSchema)
  .withOutput(resolvedFlagsOutputSchema)

  .query("experiments")
  .withInput(featureFlagTargetRequestSchema)
  .withOutput(experimentsOutputSchema)

  .mutation("setExperimentEnrolment")
  .withInput(experimentEnrolmentInputSchema)
  .withOutput(experimentWriteOutputSchema)

  .mutation("setExperimentTenantPolicy")
  .withInput(experimentTenantPolicyInputSchema)
  .withOutput(experimentWriteOutputSchema)
  .build();
