/**
 * Every `dataPrivacy.*` procedure: read the snapshot a project's privacy
 * screen renders, write a rule at one (scope, personalOnly) target, or
 * remove it so the next tier applies again.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  DATA_PRIVACY_SCOPE_TYPES,
  dataPrivacyConfigSchema,
  dataPrivacyPolicySchema,
} from "./data-privacy.ts";
import { dataPrivacySnapshotSchema } from "./data-privacy.snapshot.ts";

/** The project every privacy procedure is opened from. */
export const dataPrivacyProjectScopeSchema = z.object({ projectId: z.string() });

/** The (tier, id) pair a rule hangs on, in the tiers the contract enumerates. */
export const dataPrivacyScopeInputSchema = z.object({
  scopeType: z.enum(DATA_PRIVACY_SCOPE_TYPES),
  scopeId: z.string().min(1),
});

export const dataPrivacyScopeTargetInputSchema = z.object({
  ...dataPrivacyProjectScopeSchema.shape,
  scope: dataPrivacyScopeInputSchema,
  personalOnly: z.boolean(),
});

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
