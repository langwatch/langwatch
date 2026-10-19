/**
 * Every `personalWorkspaceFeatures.*` procedure, declared once. The bundle is
 * a navigation predicate on somebody's own workspace: turning it off hides
 * navigation and deletes nothing, and the owner is who may switch it.
 */

import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { personalFeaturesSchema } from "./personal-workspace.ts";

const personalWorkspaceFeaturesScopeSchemaDefinition = z.object({ projectId: z.string() });
export interface PersonalWorkspaceFeaturesScopeSchema extends Named<
  typeof personalWorkspaceFeaturesScopeSchemaDefinition
> {}
export const personalWorkspaceFeaturesScopeSchema: PersonalWorkspaceFeaturesScopeSchema =
  personalWorkspaceFeaturesScopeSchemaDefinition;
export type PersonalWorkspaceFeaturesScope = z.infer<typeof personalWorkspaceFeaturesScopeSchema>;

export const personalWorkspaceFeaturesTrpc = defineTrpcContract("personalWorkspaceFeatures")
  .query("get")
  .withInput(personalWorkspaceFeaturesScopeSchema)
  .withOutput(personalFeaturesSchema)

  .mutation("enableAll")
  .withInput(personalWorkspaceFeaturesScopeSchema)
  .withOutput(personalFeaturesSchema)

  .mutation("disableAll")
  .withInput(personalWorkspaceFeaturesScopeSchema)
  .withOutput(personalFeaturesSchema)
  .build();
