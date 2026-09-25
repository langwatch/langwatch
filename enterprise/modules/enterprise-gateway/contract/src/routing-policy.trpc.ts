// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every served `routingPolicy.*` procedure, declared once, at main's wire names and caps. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { MODEL_TIERS, tierTargetSuggestionSchema } from "@langwatch/model-provider-contract";
import { z } from "zod";

import { enterpriseGatewayWriteAcknowledgedSchema } from "./enterprise-gateway.responses.ts";
import {
  listRoutingPoliciesInputSchema,
  routingPolicySchema,
  routingPolicyScopeEntrySchema,
} from "./routing-policy.ts";

const policyInOrganization = z.object({ organizationId: z.string(), id: z.string() });
const policyName = z.string().min(1).max(128);
const providerIds = z
  .array(z.string())
  .min(1, "Routing policy must reference at least one provider credential");
const policyShape = {
  description: z.string().nullable().optional(),
  modelAliases: z.record(z.string(), z.string()).optional(),
  defaultModel: z.string().min(1).max(256).nullable().optional(),
  policyRules: z.record(z.string(), z.unknown()).optional(),
};

export const routingPolicyTrpc = defineTrpcContract("routingPolicy")
  .query("list")
  .withInput(listRoutingPoliciesInputSchema)
  .withOutput(routingPolicySchema.array())

  .query("get")
  .withInput(policyInOrganization)
  .withOutput(routingPolicySchema)

  .query("tierSuggestions")
  .withInput(
    z.object({
      organizationId: z.string(),
      tier: z.enum(MODEL_TIERS),
      boundProviderTypes: z.array(z.string()).default([]),
    }),
  )
  .withOutput(tierTargetSuggestionSchema.array())

  .mutation("create")
  .withInput(
    z.object({
      organizationId: z.string(),
      scopes: z
        .array(routingPolicyScopeEntrySchema)
        .min(1, "Routing policy must include at least one scope"),
      name: policyName,
      modelProviderIds: providerIds,
      isDefault: z.boolean().default(false),
      ...policyShape,
    }),
  )
  .withOutput(routingPolicySchema)

  .mutation("update")
  .withInput(
    z.object({
      ...policyInOrganization.shape,
      name: policyName.optional(),
      modelProviderIds: providerIds.optional(),
      ...policyShape,
    }),
  )
  .withOutput(routingPolicySchema)

  .mutation("setDefault")
  .withInput(policyInOrganization)
  .withOutput(routingPolicySchema)

  .mutation("delete")
  .withInput(policyInOrganization)
  .withOutput(enterpriseGatewayWriteAcknowledgedSchema)
  .build();
