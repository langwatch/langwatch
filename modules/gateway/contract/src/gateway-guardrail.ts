import { HandledError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

export const gatewayGuardrailDirectionSchema = z.enum(["PRE", "POST", "STREAM_CHUNK"]);

/**
 * The directions the Go data plane sends, per contract 4.6 — deliberately
 * NOT the stored Prisma values: conflating the two vocabularies is what
 * broke the guardrail check endpoint before. The REST family parses these.
 */
export const GUARDRAIL_WIRE_DIRECTIONS = ["request", "response", "stream_chunk"] as const;

export type GuardrailWireDirection = (typeof GUARDRAIL_WIRE_DIRECTIONS)[number];
export const gatewayGuardrailFailureModeSchema = z.enum(["FAIL_OPEN", "FAIL_CLOSED"]);

/**
 * Guardrail direction and failure mode: named types for browser label maps,
 * isolated from Prisma server implementation.
 */
export type GatewayGuardrailDirection = z.infer<typeof gatewayGuardrailDirectionSchema>;
export type GatewayGuardrailFailureMode = z.infer<typeof gatewayGuardrailFailureModeSchema>;

const gatewayGuardrailResourceSchemaDefinition = z.object({
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
export interface GatewayGuardrailResourceSchema extends Named<
  typeof gatewayGuardrailResourceSchemaDefinition
> {}
export const gatewayGuardrailResourceSchema: GatewayGuardrailResourceSchema =
  gatewayGuardrailResourceSchemaDefinition;

export type GatewayGuardrailResource = z.infer<typeof gatewayGuardrailResourceSchema>;

const gatewayGuardrailBundleEntrySchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  evaluatorId: z.string(),
  evaluatorSlug: z.string().nullable(),
  direction: z.enum(["pre", "post", "stream_chunk"]),
  failureMode: z.enum(["fail_open", "fail_closed"]),
});
export interface GatewayGuardrailBundleEntrySchema extends Named<
  typeof gatewayGuardrailBundleEntrySchemaDefinition
> {}
export const gatewayGuardrailBundleEntrySchema: GatewayGuardrailBundleEntrySchema =
  gatewayGuardrailBundleEntrySchemaDefinition;

export type GatewayGuardrailBundleEntry = z.infer<typeof gatewayGuardrailBundleEntrySchema>;

const createGatewayGuardrailInputSchemaDefinition = z.object({
  projectId: z.string(),
  name: z.string().min(1).max(128),
  description: z.string().max(512).nullable().optional(),
  evaluatorId: z.string(),
  direction: gatewayGuardrailDirectionSchema,
  failureMode: gatewayGuardrailFailureModeSchema.optional(),
  actorUserId: z.string(),
});
export interface CreateGatewayGuardrailInputSchema extends Named<
  typeof createGatewayGuardrailInputSchemaDefinition
> {}
export const createGatewayGuardrailInputSchema: CreateGatewayGuardrailInputSchema =
  createGatewayGuardrailInputSchemaDefinition;

const updateGatewayGuardrailInputSchemaDefinition = z.object({
  ...createGatewayGuardrailInputSchema.partial().shape,
  id: z.string(),
  projectId: z.string(),
  actorUserId: z.string(),
});
export interface UpdateGatewayGuardrailInputSchema extends Named<
  typeof updateGatewayGuardrailInputSchemaDefinition
> {}
export const updateGatewayGuardrailInputSchema: UpdateGatewayGuardrailInputSchema =
  updateGatewayGuardrailInputSchemaDefinition;

const archiveGatewayGuardrailInputSchemaDefinition = z.object({
  id: z.string(),
  projectId: z.string(),
  actorUserId: z.string(),
});
export interface ArchiveGatewayGuardrailInputSchema extends Named<
  typeof archiveGatewayGuardrailInputSchemaDefinition
> {}
export const archiveGatewayGuardrailInputSchema: ArchiveGatewayGuardrailInputSchema =
  archiveGatewayGuardrailInputSchemaDefinition;

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
