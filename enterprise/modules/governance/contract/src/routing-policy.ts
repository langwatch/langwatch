import { z } from "zod";

export const routingPolicyScopeTypeSchema = z.enum(["ORGANIZATION", "TEAM", "PROJECT"]);
export type RoutingPolicyScopeType = z.infer<typeof routingPolicyScopeTypeSchema>;

export const routingPolicyWireScopeSchema = z.enum(["organization", "team", "project"]);
export type RoutingPolicyWireScope = z.infer<typeof routingPolicyWireScopeSchema>;

export const routingPolicyScopeEntrySchema = z
  .object({
    scopeType: routingPolicyScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type RoutingPolicyScopeEntry = z.infer<typeof routingPolicyScopeEntrySchema>;

const stringMapSchema = z.record(z.string(), z.string());
const jsonObjectSchema = z.record(z.string(), z.unknown());

export const routingPolicySchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable(),
    modelProviderIds: z.array(z.string().min(1)),
    modelAliases: stringMapSchema,
    defaultModel: z.string().nullable(),
    policyRules: jsonObjectSchema,
    isDefault: z.boolean(),
    createdAtMs: z.number().int().nonnegative(),
    updatedAtMs: z.number().int().nonnegative(),
    createdById: z.string().nullable(),
    updatedById: z.string().nullable(),
    scopes: z.array(routingPolicyScopeEntrySchema),
  })
  .strict();
export type RoutingPolicy = z.infer<typeof routingPolicySchema>;

export const listRoutingPoliciesInputSchema = z
  .object({
    organizationId: z.string().min(1),
    selectableForScope: routingPolicyScopeEntrySchema.optional(),
  })
  .strict();
export type ListRoutingPoliciesInput = z.infer<typeof listRoutingPoliciesInputSchema>;

export const findRoutingPolicyInputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export type FindRoutingPolicyInput = z.infer<typeof findRoutingPolicyInputSchema>;

export const createRoutingPolicyInputSchema = z
  .object({
    organizationId: z.string().min(1),
    scopes: z.array(routingPolicyScopeEntrySchema).min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    modelProviderIds: z.array(z.string().min(1)).min(1),
    isDefault: z.boolean().optional(),
    modelAliases: stringMapSchema.optional(),
    defaultModel: z.string().nullable().optional(),
    policyRules: jsonObjectSchema.optional(),
    actorUserId: z.string().min(1),
  })
  .strict();
export type CreateRoutingPolicyInput = z.infer<typeof createRoutingPolicyInputSchema>;

export const updateRoutingPolicyInputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    modelProviderIds: z.array(z.string().min(1)).min(1).optional(),
    modelAliases: stringMapSchema.optional(),
    defaultModel: z.string().nullable().optional(),
    policyRules: jsonObjectSchema.optional(),
    actorUserId: z.string().min(1),
  })
  .strict();
export type UpdateRoutingPolicyInput = z.infer<typeof updateRoutingPolicyInputSchema>;

export const setDefaultRoutingPolicyInputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    actorUserId: z.string().min(1),
  })
  .strict();
export type SetDefaultRoutingPolicyInput = z.infer<typeof setDefaultRoutingPolicyInputSchema>;

export const deleteRoutingPolicyInputSchema = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export type DeleteRoutingPolicyInput = z.infer<typeof deleteRoutingPolicyInputSchema>;

export const resolveDefaultRoutingPolicyInputSchema = z
  .object({
    organizationId: z.string().min(1),
    personalTeamId: z.string().min(1).optional(),
  })
  .strict();
export type ResolveDefaultRoutingPolicyInput = z.infer<
  typeof resolveDefaultRoutingPolicyInputSchema
>;

export function toRoutingPolicyScopeType(scope: RoutingPolicyWireScope): RoutingPolicyScopeType {
  return routingPolicyScopeTypeSchema.parse(scope.toUpperCase());
}

export class RoutingPolicyMustHaveProviderError extends Error {
  readonly code = "routing_policy_must_have_provider" as const;
  constructor() {
    super("Routing policy must include at least one ModelProvider");
    this.name = "RoutingPolicyMustHaveProviderError";
  }
}

export class RoutingPolicyMustHaveScopeError extends Error {
  readonly code = "routing_policy_must_have_scope" as const;
  constructor() {
    super("Routing policy must include at least one scope");
    this.name = "RoutingPolicyMustHaveScopeError";
  }
}

export class RoutingPolicyModelMustBeConcreteError extends Error {
  readonly code = "routing_policy_model_must_be_concrete" as const;
  constructor(
    readonly field: string,
    readonly value: string,
  ) {
    super(
      `"${value}" names whichever model is newest rather than a specific one, so it cannot be stored on a routing policy. Use the model id it currently resolves to.`,
    );
    this.name = "RoutingPolicyModelMustBeConcreteError";
  }
}

export class RoutingPolicyNotFoundError extends Error {
  readonly code = "routing_policy_not_found" as const;
  constructor(readonly routingPolicyId: string) {
    super(`Routing policy ${routingPolicyId} was not found`);
    this.name = "RoutingPolicyNotFoundError";
  }
}

export class RoutingPolicyProviderScopeError extends Error {
  readonly code = "routing_policy_provider_scope" as const;
  constructor() {
    super("One or more ModelProviders are not reachable from this organization");
    this.name = "RoutingPolicyProviderScopeError";
  }
}
