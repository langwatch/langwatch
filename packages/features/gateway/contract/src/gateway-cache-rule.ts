import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";

export const gatewayCacheRuleMatchersSchema = z
  .object({
    vk_id: z.string().optional(),
    vk_tags: z.array(z.string()).optional(),
    vk_prefix: z.string().optional(),
    principal_id: z.string().optional(),
    model: z.string().optional(),
    request_metadata: z.record(z.string(), z.string()).optional(),
  })
  .strict();

export const gatewayCacheRuleActionSchema = z
  .object({
    mode: z.enum(["respect", "force", "disable"]),
    ttl: z.number().int().min(0).max(86_400).optional(),
    salt: z.string().max(64).optional(),
  })
  .strict();

export type GatewayCacheRuleMatchers = z.infer<typeof gatewayCacheRuleMatchersSchema>;
export type GatewayCacheRuleAction = z.infer<typeof gatewayCacheRuleActionSchema>;

export const gatewayCacheRuleResourceSchema = z.object({
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

export type GatewayCacheRuleResource = z.infer<typeof gatewayCacheRuleResourceSchema>;

export const createGatewayCacheRuleInputSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: gatewayCacheRuleMatchersSchema,
  action: gatewayCacheRuleActionSchema,
  actorUserId: z.string(),
});

export const updateGatewayCacheRuleInputSchema = createGatewayCacheRuleInputSchema
  .partial()
  .extend({
    id: z.string(),
    organizationId: z.string(),
    actorUserId: z.string(),
  });

export const archiveGatewayCacheRuleInputSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  actorUserId: z.string(),
});

export type CreateGatewayCacheRuleInput = z.infer<typeof createGatewayCacheRuleInputSchema>;
export type UpdateGatewayCacheRuleInput = z.infer<typeof updateGatewayCacheRuleInputSchema>;
export type ArchiveGatewayCacheRuleInput = z.infer<typeof archiveGatewayCacheRuleInputSchema>;

export type GatewayCacheRuleCursor = {
  priority: number;
  createdAt: Date;
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
