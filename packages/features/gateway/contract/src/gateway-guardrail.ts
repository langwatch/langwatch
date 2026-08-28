import { HandledError } from "@langwatch/handled-error";
import { z } from "zod";

export const gatewayGuardrailDirectionSchema = z.enum(["PRE", "POST", "STREAM_CHUNK"]);
export const gatewayGuardrailFailureModeSchema = z.enum(["FAIL_OPEN", "FAIL_CLOSED"]);

export const gatewayGuardrailResourceSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  evaluatorId: z.string(),
  direction: gatewayGuardrailDirectionSchema,
  failureMode: gatewayGuardrailFailureModeSchema,
  createdById: z.string().nullable(),
  updatedById: z.string().nullable(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type GatewayGuardrailResource = z.infer<typeof gatewayGuardrailResourceSchema>;

export const gatewayGuardrailBundleEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  evaluatorId: z.string(),
  evaluatorSlug: z.string().nullable(),
  direction: z.enum(["pre", "post", "stream_chunk"]),
  failureMode: z.enum(["fail_open", "fail_closed"]),
});

export type GatewayGuardrailBundleEntry = z.infer<typeof gatewayGuardrailBundleEntrySchema>;

export const createGatewayGuardrailInputSchema = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  evaluatorId: z.string(),
  direction: gatewayGuardrailDirectionSchema,
  failureMode: gatewayGuardrailFailureModeSchema.optional(),
  actorUserId: z.string(),
});

export const updateGatewayGuardrailInputSchema = createGatewayGuardrailInputSchema
  .partial()
  .extend({
    id: z.string(),
    projectId: z.string(),
    actorUserId: z.string(),
  });

export const archiveGatewayGuardrailInputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  actorUserId: z.string(),
});

export type CreateGatewayGuardrailInput = z.infer<typeof createGatewayGuardrailInputSchema>;
export type UpdateGatewayGuardrailInput = z.infer<typeof updateGatewayGuardrailInputSchema>;
export type ArchiveGatewayGuardrailInput = z.infer<typeof archiveGatewayGuardrailInputSchema>;

export class GatewayGuardrailNotFoundError extends HandledError {
  declare readonly code: "gateway_guardrail_not_found";

  constructor() {
    super("gateway_guardrail_not_found", "Guardrail not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "GatewayGuardrailNotFoundError";
  }
}

export class GatewayGuardrailEvaluatorInvalidError extends HandledError {
  declare readonly code: "gateway_guardrail_evaluator_invalid";

  constructor() {
    super(
      "gateway_guardrail_evaluator_invalid",
      "The evaluator must be enabled for this project and set to run as a guardrail",
      { httpStatus: 400, fault: "customer" },
    );
    this.name = "GatewayGuardrailEvaluatorInvalidError";
  }
}

export class GatewayGuardrailProjectNotFoundError extends HandledError {
  declare readonly code: "gateway_guardrail_project_not_found";

  constructor() {
    super("gateway_guardrail_project_not_found", "Project not found", {
      httpStatus: 404,
      fault: "customer",
    });
    this.name = "GatewayGuardrailProjectNotFoundError";
  }
}
