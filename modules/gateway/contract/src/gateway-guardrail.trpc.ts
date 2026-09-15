/**
 * Every `gatewayGuardrails.*` procedure, declared once. Guardrails are
 * project-scoped, unlike every other gateway resource: a virtual key opts into
 * one through its own configuration.
 */

import { z } from "zod";
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  gatewayGuardrailDirectionSchema,
  gatewayGuardrailFailureModeSchema,
  gatewayGuardrailResourceSchema,
} from "./gateway-guardrail.ts";

const projectScopeSchema = z.object({ projectId: z.string() });
const guardrailIdSchema = z.object({ projectId: z.string(), id: z.string() });

const guardrailCreateInputSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  evaluatorId: z.string(),
  direction: gatewayGuardrailDirectionSchema,
  failureMode: gatewayGuardrailFailureModeSchema.optional(),
});

const guardrailUpdateInputSchema = z.object({
  projectId: z.string(),
  id: z.string(),
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).nullable().optional(),
  evaluatorId: z.string().optional(),
  direction: gatewayGuardrailDirectionSchema.optional(),
  failureMode: gatewayGuardrailFailureModeSchema.optional(),
});

/** The archive acknowledgement, as the browser has always read it. */
const guardrailArchivedSchema = z.object({ ok: z.literal(true) }).strict();

export const gatewayGuardrailTrpc = defineTrpcContract("gatewayGuardrails")
  .query("list")
  .withInput(projectScopeSchema)
  .withOutput(gatewayGuardrailResourceSchema.array())

  .query("get")
  .withInput(guardrailIdSchema)
  .withOutput(gatewayGuardrailResourceSchema.nullable())

  .mutation("create")
  .withInput(guardrailCreateInputSchema)
  .withOutput(gatewayGuardrailResourceSchema)

  .mutation("update")
  .withInput(guardrailUpdateInputSchema)
  .withOutput(gatewayGuardrailResourceSchema)

  .mutation("archive")
  .withInput(guardrailIdSchema)
  .withOutput(guardrailArchivedSchema)
  .build();
