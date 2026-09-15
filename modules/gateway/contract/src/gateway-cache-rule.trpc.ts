/**
 * Every `gatewayCacheRules.*` procedure, declared once. The rules are
 * organization-scoped; the gateway itself reads them through the config
 * bundle, so this namespace is the platform surface for the rules themselves.
 */

import { z } from "zod";
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  gatewayCacheRuleActionSchema,
  gatewayCacheRuleMatchersSchema,
} from "./gateway-cache-rule.ts";
import { gatewayCacheRuleDtoSchema } from "./gateway.responses.ts";

const organizationScopeSchema = z.object({ organizationId: z.string() });
const cacheRuleIdSchema = z.object({ organizationId: z.string(), id: z.string() });

const cacheRuleCreateInputSchema = z.object({
  organizationId: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: gatewayCacheRuleMatchersSchema,
  action: gatewayCacheRuleActionSchema,
});

const cacheRuleUpdateInputSchema = z.object({
  organizationId: z.string(),
  id: z.string(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).nullable().optional(),
  priority: z.number().int().min(0).max(1_000).optional(),
  enabled: z.boolean().optional(),
  matchers: gatewayCacheRuleMatchersSchema.optional(),
  action: gatewayCacheRuleActionSchema.optional(),
});

export const gatewayCacheRuleTrpc = defineTrpcContract("gatewayCacheRules")
  .query("list")
  .withInput(organizationScopeSchema)
  .withOutput(gatewayCacheRuleDtoSchema.array())

  .query("get")
  .withInput(cacheRuleIdSchema)
  .withOutput(gatewayCacheRuleDtoSchema)

  .mutation("create")
  .withInput(cacheRuleCreateInputSchema)
  .withOutput(gatewayCacheRuleDtoSchema)

  .mutation("update")
  .withInput(cacheRuleUpdateInputSchema)
  .withOutput(gatewayCacheRuleDtoSchema)

  .mutation("archive")
  .withInput(cacheRuleIdSchema)
  .withOutput(gatewayCacheRuleDtoSchema)
  .build();
