import { z } from "zod";

/**
 * Governance signals delivered over the webhook platform: virtual-key
 * lifecycle changes and budget threshold/breach crossings. Event data is
 * business-cut and content-free (ids, states, integer-safe amounts as
 * strings), so envelopes can embed it verbatim.
 */

export const vkLifecycleActionSchema = z.enum([
  "created",
  "rotated",
  "disabled",
  "enabled",
  "revoked",
]);
export type VkLifecycleAction = z.infer<typeof vkLifecycleActionSchema>;

export const recordVkLifecycleCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organization_id: z.string().min(1),
  virtual_key_id: z.string().min(1),
  action: vkLifecycleActionSchema,
  name: z.string(),
  display_prefix: z.string(),
  reason: z.string().nullable().default(null),
  /** Unix ms of the mutation. */
  occurred_at: z.number().int().positive(),
});
export type RecordVkLifecycleCommandData = z.infer<
  typeof recordVkLifecycleCommandDataSchema
>;

export const budgetCrossingKindSchema = z.enum(["threshold_crossed", "breached"]);
export type BudgetCrossingKind = z.infer<typeof budgetCrossingKindSchema>;

export const recordBudgetCrossingCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  organization_id: z.string().min(1),
  budget_id: z.string().min(1),
  kind: budgetCrossingKindSchema,
  scope_type: z.string().min(1),
  /** The ledger bucket that crossed (a template's is "<anchor>:<endUser>"). */
  bucket_scope_id: z.string().min(1),
  end_user_id: z.string().nullable().default(null),
  /**
   * The virtual key this budget targets, when it targets one: its own scope
   * for a VIRTUAL_KEY budget, the anchor for an ATTRIBUTED_USER template.
   * Null for budgets scoped to an org, team, project, group, or principal.
   *
   * A consumer rebilling on these events keys on the virtual key, and
   * `bucket_scope_id` only carries it as the prefix of a composite it would
   * have to parse (and could not tell apart from an end user id containing a
   * colon).
   */
  virtual_key_id: z.string().nullable().default(null),
  /** The project this budget is anchored to, when it is scoped to one. */
  anchor_project_id: z.string().nullable().default(null),
  window: z.string().min(1),
  /** Period identity for once-per-crossing-per-period dedup, unix ms. */
  period_started_at_ms: z.number().int().min(0),
  limit_usd: z.string(),
  spent_usd: z.string(),
  on_breach: z.enum(["block", "warn"]),
  occurred_at: z.number().int().positive(),
});
export type RecordBudgetCrossingCommandData = z.infer<
  typeof recordBudgetCrossingCommandDataSchema
>;
