import type { Named } from "@langwatch/module";
/**
 * VirtualKey tRPC input shapes; minted keys never inputs (responses only),
 * budget parsing injected to share canonical parser.
 */
import { z } from "zod";

import { virtualKeyConfigSchema } from "./virtual-key-config.ts";

/** How a key picks a provider when its primary is unavailable. */
export const virtualKeyApiRoutingModeSchema = z.enum(["NONE", "FALLBACK_ALL", "POLICY"]);

/**
 * The gateway's own scope-assignment wire shape. Every handler hands parsed
 * `scopes[]` straight to the virtual-key port's `GatewayVirtualKeyScope[]`,
 * so a tier missing from this enum is a compile error, not a silent value.
 */
const virtualKeyApiScopeAssignmentSchemaDefinition = z.object({
  scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
  scopeId: z.string().min(1),
});
export interface VirtualKeyApiScopeAssignmentSchema extends Named<
  typeof virtualKeyApiScopeAssignmentSchemaDefinition
> {}
export const virtualKeyApiScopeAssignmentSchema: VirtualKeyApiScopeAssignmentSchema =
  virtualKeyApiScopeAssignmentSchemaDefinition;

/** One organization, the tenant key every procedure on this surface takes. */
const virtualKeyApiOrganizationInputSchemaDefinition = z.object({ organizationId: z.string() });
export interface VirtualKeyApiOrganizationInputSchema extends Named<
  typeof virtualKeyApiOrganizationInputSchemaDefinition
> {}
export const virtualKeyApiOrganizationInputSchema: VirtualKeyApiOrganizationInputSchema =
  virtualKeyApiOrganizationInputSchemaDefinition;

/** One key inside one organization. */
const virtualKeyApiKeyInputSchemaDefinition = z.object({
  organizationId: z.string(),
  id: z.string(),
});
export interface VirtualKeyApiKeyInputSchema extends Named<
  typeof virtualKeyApiKeyInputSchemaDefinition
> {}
export const virtualKeyApiKeyInputSchema: VirtualKeyApiKeyInputSchema =
  virtualKeyApiKeyInputSchemaDefinition;

/** Disabling a key, with the optional operator note recorded against it. */
const virtualKeyApiDisableInputSchemaDefinition = z.object({
  ...virtualKeyApiKeyInputSchema.shape,
  reason: z.string().max(500).optional(),
});
export interface VirtualKeyApiDisableInputSchema extends Named<
  typeof virtualKeyApiDisableInputSchemaDefinition
> {}
export const virtualKeyApiDisableInputSchema: VirtualKeyApiDisableInputSchema =
  virtualKeyApiDisableInputSchemaDefinition;

/**
 * The budgets that would apply to an existing key, or to a draft the create
 * drawer has not submitted yet — hence the nullable key id alongside the
 * scopes.
 */
const virtualKeyApiApplicableBudgetsInputSchemaDefinition = z.object({
  organizationId: z.string(),
  virtualKeyId: z.string().nullable().optional(),
  scopes: z.array(virtualKeyApiScopeAssignmentSchema).min(1),
  traceProjectId: z.string().nullable().optional(),
  principalUserId: z.string().nullable().optional(),
});
export interface VirtualKeyApiApplicableBudgetsInputSchema extends Named<
  typeof virtualKeyApiApplicableBudgetsInputSchemaDefinition
> {}
export const virtualKeyApiApplicableBudgetsInputSchema: VirtualKeyApiApplicableBudgetsInputSchema =
  virtualKeyApiApplicableBudgetsInputSchemaDefinition;

/**
 * The budget a key carries on itself, created in the same transaction.
 * `null` on update archives it. One parser, shared by tRPC and REST, so the
 * decimal regex and positive-amount refinement cannot drift into two answers.
 */
const virtualKeyBudgetInputSchemaDefinition = z.object({
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
export interface VirtualKeyBudgetInputSchema extends Named<
  typeof virtualKeyBudgetInputSchemaDefinition
> {}
export const virtualKeyBudgetInputSchema: VirtualKeyBudgetInputSchema =
  virtualKeyBudgetInputSchemaDefinition;

export type VirtualKeyBudgetInput = z.infer<typeof virtualKeyBudgetInputSchema>;

/** Minting a key, over the one canonical budget parser above. */
const virtualKeyApiCreateInputSchemaDefinition = z.object({
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
  /** Also park the secret under a one-time reveal id; the secret is still returned. */
  revealOnce: z.boolean().optional(),
});
export interface VirtualKeyApiCreateInputSchema extends Named<
  typeof virtualKeyApiCreateInputSchemaDefinition
> {}
export const virtualKeyApiCreateInputSchema: VirtualKeyApiCreateInputSchema =
  virtualKeyApiCreateInputSchemaDefinition;

/** Editing a key, over the same parser. */
const virtualKeyApiUpdateInputSchemaDefinition = z.object({
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
export interface VirtualKeyApiUpdateInputSchema extends Named<
  typeof virtualKeyApiUpdateInputSchemaDefinition
> {}
export const virtualKeyApiUpdateInputSchema: VirtualKeyApiUpdateInputSchema =
  virtualKeyApiUpdateInputSchemaDefinition;

export type VirtualKeyApiRoutingMode = z.infer<typeof virtualKeyApiRoutingModeSchema>;
export type VirtualKeyApiScopeAssignment = z.infer<typeof virtualKeyApiScopeAssignmentSchema>;
export type VirtualKeyApiOrganizationInput = z.infer<typeof virtualKeyApiOrganizationInputSchema>;
export type VirtualKeyApiKeyInput = z.infer<typeof virtualKeyApiKeyInputSchema>;
export type VirtualKeyApiDisableInput = z.infer<typeof virtualKeyApiDisableInputSchema>;
export type VirtualKeyApiApplicableBudgetsInput = z.infer<
  typeof virtualKeyApiApplicableBudgetsInputSchema
>;
