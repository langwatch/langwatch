/**
 * Every `featureFlag.*` procedure, declared once. The browser reads the same
 * names and schemas as types; the server binds a permission and a handler to
 * each of them and repeats nothing.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
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

export const enabledOutputSchema = z.object({ enabled: z.boolean() }).strict();
export const enabledByOrganizationOutputSchema = z
  .object({ enabledByOrganizationId: z.record(z.string(), z.boolean()) })
  .strict();
export const resolvedFlagsOutputSchema = z.object({ flags: frontendFeatureFlagMapSchema }).strict();
export const experimentsOutputSchema = z
  .object({ experiments: z.array(experimentCatalogueEntrySchema) })
  .strict();
export const experimentWriteOutputSchema = z.object({ ok: z.literal(true) }).strict();

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
