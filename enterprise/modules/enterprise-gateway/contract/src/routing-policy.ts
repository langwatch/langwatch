import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { personalWorkspaceSchema } from "@langwatch/organization-contract";
import { z } from "zod";

export const routingPolicyScopeTypeSchema = z.enum(["ORGANIZATION", "TEAM", "PROJECT"]);
export type RoutingPolicyScopeType = z.infer<typeof routingPolicyScopeTypeSchema>;

export const routingPolicyWireScopeSchema = z.enum(["organization", "team", "project"]);
export type RoutingPolicyWireScope = z.infer<typeof routingPolicyWireScopeSchema>;

const routingPolicyScopeEntrySchemaDefinition = z
  .object({
    scopeType: routingPolicyScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export interface RoutingPolicyScopeEntrySchema extends Named<
  typeof routingPolicyScopeEntrySchemaDefinition
> {}
export const routingPolicyScopeEntrySchema: RoutingPolicyScopeEntrySchema =
  routingPolicyScopeEntrySchemaDefinition;
export type RoutingPolicyScopeEntry = z.infer<typeof routingPolicyScopeEntrySchema>;

const stringMapSchema = z.record(z.string(), z.string());
const jsonObjectSchema = z.record(z.string(), z.unknown());

const routingPolicySchemaDefinition = z
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
export interface RoutingPolicySchema extends Named<typeof routingPolicySchemaDefinition> {}
export const routingPolicySchema: RoutingPolicySchema = routingPolicySchemaDefinition;
export type RoutingPolicy = z.infer<typeof routingPolicySchema>;

const listRoutingPoliciesInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    selectableForScope: routingPolicyScopeEntrySchema.optional(),
  })
  .strict();
export interface ListRoutingPoliciesInputSchema extends Named<
  typeof listRoutingPoliciesInputSchemaDefinition
> {}
export const listRoutingPoliciesInputSchema: ListRoutingPoliciesInputSchema =
  listRoutingPoliciesInputSchemaDefinition;
export type ListRoutingPoliciesInput = z.infer<typeof listRoutingPoliciesInputSchema>;

const findRoutingPolicyInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export interface FindRoutingPolicyInputSchema extends Named<
  typeof findRoutingPolicyInputSchemaDefinition
> {}
export const findRoutingPolicyInputSchema: FindRoutingPolicyInputSchema =
  findRoutingPolicyInputSchemaDefinition;
export type FindRoutingPolicyInput = z.infer<typeof findRoutingPolicyInputSchema>;

const createRoutingPolicyInputSchemaDefinition = z
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
export interface CreateRoutingPolicyInputSchema extends Named<
  typeof createRoutingPolicyInputSchemaDefinition
> {}
export const createRoutingPolicyInputSchema: CreateRoutingPolicyInputSchema =
  createRoutingPolicyInputSchemaDefinition;
export type CreateRoutingPolicyInput = z.infer<typeof createRoutingPolicyInputSchema>;

const updateRoutingPolicyInputSchemaDefinition = z
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
export interface UpdateRoutingPolicyInputSchema extends Named<
  typeof updateRoutingPolicyInputSchemaDefinition
> {}
export const updateRoutingPolicyInputSchema: UpdateRoutingPolicyInputSchema =
  updateRoutingPolicyInputSchemaDefinition;
export type UpdateRoutingPolicyInput = z.infer<typeof updateRoutingPolicyInputSchema>;

const setDefaultRoutingPolicyInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    actorUserId: z.string().min(1),
  })
  .strict();
export interface SetDefaultRoutingPolicyInputSchema extends Named<
  typeof setDefaultRoutingPolicyInputSchemaDefinition
> {}
export const setDefaultRoutingPolicyInputSchema: SetDefaultRoutingPolicyInputSchema =
  setDefaultRoutingPolicyInputSchemaDefinition;
export type SetDefaultRoutingPolicyInput = z.infer<typeof setDefaultRoutingPolicyInputSchema>;

const deleteRoutingPolicyInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export interface DeleteRoutingPolicyInputSchema extends Named<
  typeof deleteRoutingPolicyInputSchemaDefinition
> {}
export const deleteRoutingPolicyInputSchema: DeleteRoutingPolicyInputSchema =
  deleteRoutingPolicyInputSchemaDefinition;
export type DeleteRoutingPolicyInput = z.infer<typeof deleteRoutingPolicyInputSchema>;

const resolveDefaultRoutingPolicyInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    personalTeamId: z.string().min(1).optional(),
  })
  .strict();
export interface ResolveDefaultRoutingPolicyInputSchema extends Named<
  typeof resolveDefaultRoutingPolicyInputSchemaDefinition
> {}
export const resolveDefaultRoutingPolicyInputSchema: ResolveDefaultRoutingPolicyInputSchema =
  resolveDefaultRoutingPolicyInputSchemaDefinition;
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

/** `project.apiKey` is always blank: a cached read carries no credential. */
const personalContextWorkspaceSchema = personalWorkspaceSchema.safeExtend({
  project: personalWorkspaceSchema.shape.project.safeExtend({ apiKey: z.string() }),
  created: z.boolean(),
});

/**
 * The caller's personal workspace inside one organization, plus the routing
 * policy it inherits by default. Null where the organization declares none.
 */
const personalContextSchemaDefinition = z
  .object({
    workspace: personalContextWorkspaceSchema,
    routingPolicy: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
  })
  .strict();
export interface PersonalContextSchema extends Named<typeof personalContextSchemaDefinition> {}
export const personalContextSchema: PersonalContextSchema = personalContextSchemaDefinition;
export type PersonalContext = z.infer<typeof personalContextSchema>;
