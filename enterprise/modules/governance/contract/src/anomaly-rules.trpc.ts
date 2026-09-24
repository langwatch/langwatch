// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Every `anomalyRules.*` procedure, declared once, at main's wire names. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  anomalyRuleSchema,
  createAnomalyRuleInputSchema,
  updateAnomalyRuleInputSchema,
} from "./anomaly-rule.ts";

const organizationScope = z.object({ organizationId: z.string() });
const ruleInOrganization = z.object({ ...organizationScope.shape, id: z.string() });

export const anomalyRulesTrpc = defineTrpcContract("anomalyRules")
  .query("list")
  .withInput(organizationScope)
  .withOutput(anomalyRuleSchema.array())

  .query("get")
  .withInput(ruleInOrganization)
  .withOutput(anomalyRuleSchema)

  .mutation("create")
  .withInput(createAnomalyRuleInputSchema.omit({ actorUserId: true }))
  .withOutput(anomalyRuleSchema)

  .mutation("update")
  .withInput(updateAnomalyRuleInputSchema)
  .withOutput(anomalyRuleSchema)

  .mutation("archive")
  .withInput(ruleInOrganization)
  .withOutput(anomalyRuleSchema)
  .build();
