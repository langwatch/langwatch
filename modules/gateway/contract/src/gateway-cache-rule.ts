import { HandledError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

const gatewayCacheRuleMatchersSchemaDefinition = z
  .object({
    vk_id: z.string().optional(),
    vk_tags: z.array(z.string()).optional(),
    vk_prefix: z.string().optional(),
    principal_id: z.string().optional(),
    model: z.string().optional(),
    request_metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();
export interface GatewayCacheRuleMatchersSchema extends Named<
  typeof gatewayCacheRuleMatchersSchemaDefinition
> {}
export const gatewayCacheRuleMatchersSchema: GatewayCacheRuleMatchersSchema =
  gatewayCacheRuleMatchersSchemaDefinition;

const gatewayCacheRuleActionSchemaDefinition = z
  .object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().min(0).max(86_400).optional(),
    salt: z.string().max(64).optional(),
  })
  .strict();
export interface GatewayCacheRuleActionSchema extends Named<
  typeof gatewayCacheRuleActionSchemaDefinition
> {}
export const gatewayCacheRuleActionSchema: GatewayCacheRuleActionSchema =
  gatewayCacheRuleActionSchemaDefinition;

export type GatewayCacheRuleMatchers = z.infer<typeof gatewayCacheRuleMatchersSchema>;
export type GatewayCacheRuleAction = z.infer<typeof gatewayCacheRuleActionSchema>;

const gatewayCacheRuleResourceSchemaDefinition = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priority: z.number().int(),
  enabled: z.boolean(),
  matchers: gatewayCacheRuleMatchersSchema,
  action: gatewayCacheRuleActionSchema,
  mode: z.enum(["RESPECT", "FORCE", "DISABLE"]),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
  createdById: z.string(),
});
export interface GatewayCacheRuleResourceSchema extends Named<
  typeof gatewayCacheRuleResourceSchemaDefinition
> {}
export const gatewayCacheRuleResourceSchema: GatewayCacheRuleResourceSchema =
  gatewayCacheRuleResourceSchemaDefinition;

export type GatewayCacheRuleResource = z.infer<typeof gatewayCacheRuleResourceSchema>;

const createGatewayCacheRuleInputSchemaDefinition = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: gatewayCacheRuleMatchersSchema,
  action: gatewayCacheRuleActionSchema,
  actorUserId: z.string(),
});
export interface CreateGatewayCacheRuleInputSchema extends Named<
  typeof createGatewayCacheRuleInputSchemaDefinition
> {}
export const createGatewayCacheRuleInputSchema: CreateGatewayCacheRuleInputSchema =
  createGatewayCacheRuleInputSchemaDefinition;

const updateGatewayCacheRuleInputSchemaDefinition = z.object({
  ...createGatewayCacheRuleInputSchema.partial().shape,
  id: z.string(),
  organizationId: z.string(),
  actorUserId: z.string(),
});
export interface UpdateGatewayCacheRuleInputSchema extends Named<
  typeof updateGatewayCacheRuleInputSchemaDefinition
> {}
export const updateGatewayCacheRuleInputSchema: UpdateGatewayCacheRuleInputSchema =
  updateGatewayCacheRuleInputSchemaDefinition;

const archiveGatewayCacheRuleInputSchemaDefinition = z.object({
  id: z.string(),
  organizationId: z.string(),
  actorUserId: z.string(),
});
export interface ArchiveGatewayCacheRuleInputSchema extends Named<
  typeof archiveGatewayCacheRuleInputSchemaDefinition
> {}
export const archiveGatewayCacheRuleInputSchema: ArchiveGatewayCacheRuleInputSchema =
  archiveGatewayCacheRuleInputSchemaDefinition;

export type CreateGatewayCacheRuleInput = z.infer<typeof createGatewayCacheRuleInputSchema>;
export type UpdateGatewayCacheRuleInput = z.infer<typeof updateGatewayCacheRuleInputSchema>;
export type ArchiveGatewayCacheRuleInput = z.infer<typeof archiveGatewayCacheRuleInputSchema>;

export type GatewayCacheRuleCursor = {
  priority: number;
  createdAt: Instant;
  id: string;
};

export class GatewayCacheRuleNotFoundError extends HandledError {
  declare readonly code: "gateway_cache_rule_not_found";

  constructor() {
    super("gateway_cache_rule_not_found", "Cache rule not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "GatewayCacheRuleNotFoundError";
  }
}
