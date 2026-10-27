/**
 * Every `dataPrivacy.*` procedure: read the snapshot a project's privacy
 * screen renders, write a rule at one (scope, personalOnly) target, or
 * remove it so the next tier applies again.
 */

import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import { dataPrivacySnapshotSchema } from "./data-privacy.snapshot.ts";
import {
  DATA_PRIVACY_SCOPE_TYPES,
  dataPrivacyConfigSchema,
  dataPrivacyPolicySchema,
} from "./data-privacy.ts";

/** The project every privacy procedure is opened from. */
const dataPrivacyProjectScopeSchemaDefinition = z.object({ projectId: z.string() });
export interface DataPrivacyProjectScopeSchema extends Named<
  typeof dataPrivacyProjectScopeSchemaDefinition
> {}
export const dataPrivacyProjectScopeSchema: DataPrivacyProjectScopeSchema =
  dataPrivacyProjectScopeSchemaDefinition;

/** The (tier, id) pair a rule hangs on, in the tiers the contract enumerates. */
const dataPrivacyScopeInputSchemaDefinition = z.object({
  scopeType: z.enum(DATA_PRIVACY_SCOPE_TYPES),
  scopeId: z.string().min(1),
});
export interface DataPrivacyScopeInputSchema extends Named<
  typeof dataPrivacyScopeInputSchemaDefinition
> {}
export const dataPrivacyScopeInputSchema: DataPrivacyScopeInputSchema =
  dataPrivacyScopeInputSchemaDefinition;

const dataPrivacyScopeTargetInputSchemaDefinition = z.object({
  ...dataPrivacyProjectScopeSchema.shape,
  scope: dataPrivacyScopeInputSchema,
  personalOnly: z.boolean(),
});
export interface DataPrivacyScopeTargetInputSchema extends Named<
  typeof dataPrivacyScopeTargetInputSchemaDefinition
> {}
export const dataPrivacyScopeTargetInputSchema: DataPrivacyScopeTargetInputSchema =
  dataPrivacyScopeTargetInputSchemaDefinition;

export const dataPrivacyTrpc = defineTrpcContract("dataPrivacy")
  /**
   * The privacy settings snapshot for one project: the effective policy,
   * readable rules by scope, and writable scopes. RBAC-filters at each
   * tier, so a wider read gate would not widen the answer.
   */
  .query("getSnapshot")
  .withInput(dataPrivacyProjectScopeSchema)
  .withOutput(dataPrivacySnapshotSchema)

  /**
   * Write the rule at one target, authorized on the TARGET scope (not the
   * project named): ORGANIZATION/DEPARTMENT need `organization:manage`, TEAM
   * `team:manage`, PROJECT `project:update` — so no member can push a rule up.
   */
  .mutation("setForScope")
  .withInput(
    z.object({ ...dataPrivacyScopeTargetInputSchema.shape, config: dataPrivacyConfigSchema }),
  )
  .withOutput(dataPrivacyPolicySchema)

  /** Remove the rule at one target; the next tier up then applies. */
  .mutation("removeForScope")
  .withInput(dataPrivacyScopeTargetInputSchema)
  .build();
