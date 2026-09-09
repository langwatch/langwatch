/**
 * Every `dataPrivacy.*` procedure, declared once: read the snapshot a project's
 * privacy screen renders, write the rule at one (scope, personalOnly) target,
 * and remove it so the next tier applies again. The settings page reads these
 * same schemas as its client's types.
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
   * The privacy settings snapshot for one project: the effective resolved
   * policy, the rules the caller may read grouped by scope, and the scopes the
   * caller may write. The snapshot RBAC-filters what it returns at each tier,
   * so a wider read gate would not widen the answer.
   */
  .query("getSnapshot")
  .withInput(dataPrivacyProjectScopeSchema)
  .withOutput(dataPrivacySnapshotSchema)

  /**
   * Write the rule at one target. Authorized on the TARGET scope, not on the
   * project the request names — ORGANIZATION and DEPARTMENT need
   * `organization:manage`, TEAM needs `team:manage`, PROJECT needs
   * `project:update` — so a project member cannot push a rule up to the
   * organization.
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
