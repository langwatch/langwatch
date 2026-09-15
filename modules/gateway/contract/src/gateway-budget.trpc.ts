/**
 * Every `gatewayBudgets.*` procedure, declared once. A budget belongs to one
 * organization and is read either through it or through a project inside it,
 * so both list shapes answer the same enriched row.
 */

import { defineTrpcContract } from "@langwatch/api/contract";

import {
  gatewayBudgetApiBudgetInputSchema,
  gatewayBudgetApiCreateInputSchema,
  gatewayBudgetApiOrganizationInputSchema,
  gatewayBudgetApiProjectInputSchema,
  gatewayBudgetApiResetInputSchema,
  gatewayBudgetApiUpdateInputSchema,
} from "./gateway.budget.ts";
import {
  gatewayBudgetDetailSchema,
  gatewayBudgetDtoResponseSchema,
  gatewayBudgetGroupTargetsSchema,
  gatewayBudgetListSchema,
} from "./gateway.responses.ts";

export const gatewayBudgetTrpc = defineTrpcContract("gatewayBudgets")
  .query("list")
  .withInput(gatewayBudgetApiOrganizationInputSchema)
  .withOutput(gatewayBudgetListSchema)

  /** The same list narrowed to one project, for a workspace that owns a single one. */
  .query("listForProject")
  .withInput(gatewayBudgetApiProjectInputSchema)
  .withOutput(gatewayBudgetListSchema)

  .query("get")
  .withInput(gatewayBudgetApiBudgetInputSchema)
  .withOutput(gatewayBudgetDetailSchema)

  /** The groups a per-member allowance can be pointed at, with their sizes. */
  .query("groupTargets")
  .withInput(gatewayBudgetApiOrganizationInputSchema)
  .withOutput(gatewayBudgetGroupTargetsSchema)

  .mutation("create")
  .withInput(gatewayBudgetApiCreateInputSchema)
  .withOutput(gatewayBudgetDtoResponseSchema)

  .mutation("update")
  .withInput(gatewayBudgetApiUpdateInputSchema)
  .withOutput(gatewayBudgetDtoResponseSchema)

  .mutation("archive")
  .withInput(gatewayBudgetApiBudgetInputSchema)
  .withOutput(gatewayBudgetDtoResponseSchema)

  .mutation("reset")
  .withInput(gatewayBudgetApiResetInputSchema)
  .withOutput(gatewayBudgetDtoResponseSchema)
  .build();
