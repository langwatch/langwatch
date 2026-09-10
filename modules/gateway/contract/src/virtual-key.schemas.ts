/**
 * The inputs the `virtualKeys.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * Nothing here describes a credential. The minted key is a response from
 * `create` and `rotate` and never an input, so no schema in this module carries
 * secret material and none of it reaches the audited argument record.
 *
 * `create` and `update` are factories rather than constants because the budget
 * they accept is parsed by a schema the process injects — the canonical budget
 * parser, whose decimal regex and positive-amount refinement are the write
 * path's contract. Taking it as a parameter keeps that single definition and
 * still lets the surrounding shape live here.
 */
import { z } from "zod";
import { virtualKeyConfigSchema } from "./virtual-key-config.ts";

/** How a key picks a provider when its primary is unavailable. */
export const virtualKeyApiRoutingModeSchema = z.enum(["NONE", "FALLBACK_ALL", "POLICY"]);

/**
 * The gateway's own scope-assignment wire shape. Every handler hands a parsed
 * `scopes[]` straight to the virtual-key port, which takes
 * `GatewayVirtualKeyScope[]`, so a tier added to the key's scope vocabulary
 * and not to this enum is a compile error at each of those call sites rather
 * than a silently unaccepted value.
 */
export const virtualKeyApiScopeAssignmentSchema = z.object({
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});

/** One organization, the tenant key every procedure on this surface takes. */
export const virtualKeyApiOrganizationInputSchema = z.object({ organizationId: z.string() });

/** One key inside one organization. */
export const virtualKeyApiKeyInputSchema = z.object({
  organizationId: z.string(),
  id: z.string(),
});

/** Disabling a key, with the optional operator note recorded against it. */
export const virtualKeyApiDisableInputSchema = virtualKeyApiKeyInputSchema.extend({
  reason: z.string().max(500).optional(),
});

/**
 * The budgets that would apply to an existing key, or to a draft the create
 * drawer has not submitted yet — hence the nullable key id alongside the
 * scopes.
 */
export const virtualKeyApiApplicableBudgetsInputSchema = z.object({
  organizationId: z.string(),
  virtualKeyId: z.string().nullable().optional(),
  scopes: z.array(virtualKeyApiScopeAssignmentSchema).min(1),
  traceProjectId: z.string().nullable().optional(),
  principalUserId: z.string().nullable().optional(),
});

/**
 * The budget a key carries on itself, created in the same transaction as the
 * key. `null` on update removes the cap by archiving. One parser, shared by
 * tRPC and REST, so the decimal regex and the positive-amount refinement
 * cannot drift into two answers.
 */
export const virtualKeyBudgetInputSchema = z.object({
  // A decimal number of dollars, strictly positive. String rather
  // than number to survive JSON round-trips without float drift; the
  // regex rejects partial parses ("10abs"), signs, and bare dots.
  limitUsd: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, "limitUsd must be a decimal number")
    .refine((v) => Number.parseFloat(v) > 0, {
      message: "limitUsd must be greater than zero",
    }),
  window: z.enum(["DAY", "WEEK", "MONTH"]),
  onBreach: z.enum(["BLOCK", "WARN"]).optional(),
  name: z.string().min(1).max(128).optional(),
});

export type VirtualKeyBudgetInput = z.infer<typeof virtualKeyBudgetInputSchema>;

/** Minting a key, over the one canonical budget parser above. */
export const virtualKeyApiCreateInputSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().optional(),
  principalUserId: z.string().nullable().optional(),
  scopes: z.array(virtualKeyApiScopeAssignmentSchema).min(1),
  traceProjectId: z.string().nullable().optional(),
  routingPolicyId: z.string().nullable().optional(),
  routingMode: virtualKeyApiRoutingModeSchema.optional(),
  /** When the key stops serving. Omit it and the key never expires. */
  expiresAt: z.coerce.date().optional(),
  budget: virtualKeyBudgetInputSchema.nullable().optional(),
  config: virtualKeyConfigSchema.partial().optional(),
});

/** Editing a key, over the same parser. */
export const virtualKeyApiUpdateInputSchema = z.object({
  organizationId: z.string(),
  id: z.string(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().nullable().optional(),
  scopes: z.array(virtualKeyApiScopeAssignmentSchema).min(1).optional(),
  traceProjectId: z.string().nullable().optional(),
  routingPolicyId: z.string().nullable().optional(),
  routingMode: virtualKeyApiRoutingModeSchema.optional(),
  /** Omitted leaves it alone; null clears it; a date moves it. */
  expiresAt: z.coerce.date().nullable().optional(),
  budget: virtualKeyBudgetInputSchema.nullable().optional(),
  config: virtualKeyConfigSchema.partial().optional(),
});

export type VirtualKeyApiRoutingMode = z.infer<typeof virtualKeyApiRoutingModeSchema>;
export type VirtualKeyApiScopeAssignment = z.infer<typeof virtualKeyApiScopeAssignmentSchema>;
export type VirtualKeyApiOrganizationInput = z.infer<typeof virtualKeyApiOrganizationInputSchema>;
export type VirtualKeyApiKeyInput = z.infer<typeof virtualKeyApiKeyInputSchema>;
export type VirtualKeyApiDisableInput = z.infer<typeof virtualKeyApiDisableInputSchema>;
export type VirtualKeyApiApplicableBudgetsInput = z.infer<
  typeof virtualKeyApiApplicableBudgetsInputSchema
>;
