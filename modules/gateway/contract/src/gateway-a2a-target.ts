import type { Named } from "@langwatch/module";
import { z } from "zod";

/** The path segment a caller names in /a2a/{name}. */
export const gatewayA2aTargetNameSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, "use lowercase letters, digits and hyphens");

const httpUrlSchema = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), "must be an http or https URL");

const gatewayA2aTargetHeadersSchemaDefinition = z
  .record(z.string().regex(/^[A-Za-z0-9-]{1,128}$/), z.string().max(4096))
  .refine((headers) => Object.keys(headers).length <= 20, "at most 20 headers");
export interface GatewayA2aTargetHeadersSchema extends Named<
  typeof gatewayA2aTargetHeadersSchemaDefinition
> {}
export const gatewayA2aTargetHeadersSchema: GatewayA2aTargetHeadersSchema =
  gatewayA2aTargetHeadersSchemaDefinition;

const gatewayA2aTargetResourceSchemaDefinition = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string().nullable(),
  name: gatewayA2aTargetNameSchema,
  agentName: z.string(),
  cardUrl: httpUrlSchema,
  upstreamUrl: httpUrlSchema,
  upstreamHeaders: gatewayA2aTargetHeadersSchema,
  /** Null admits every key of the scope; a list admits only the keys it names. */
  allowedVirtualKeyIds: z.array(z.string()).nullable(),
  blocked: z.boolean(),
  blockReason: z.string().nullable(),
  createdById: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
  archivedAt: z.date().nullable(),
});
export interface GatewayA2aTargetResourceSchema extends Named<
  typeof gatewayA2aTargetResourceSchemaDefinition
> {}
export const gatewayA2aTargetResourceSchema: GatewayA2aTargetResourceSchema =
  gatewayA2aTargetResourceSchemaDefinition;
export type GatewayA2aTargetResource = z.infer<typeof gatewayA2aTargetResourceSchema>;

const createGatewayA2aTargetInputSchemaDefinition = z.object({
  organizationId: z.string(),
  projectId: z.string().nullable(),
  name: gatewayA2aTargetNameSchema,
  agentName: z.string().min(1).max(128),
  cardUrl: httpUrlSchema,
  upstreamUrl: httpUrlSchema,
  upstreamHeaders: gatewayA2aTargetHeadersSchema.default({}),
  allowedVirtualKeyIds: z.array(z.string()).max(500).nullable().default(null),
  blocked: z.boolean().default(false),
  blockReason: z.string().max(512).nullable().default(null),
  actorUserId: z.string(),
});
export interface CreateGatewayA2aTargetInputSchema extends Named<
  typeof createGatewayA2aTargetInputSchemaDefinition
> {}
export const createGatewayA2aTargetInputSchema: CreateGatewayA2aTargetInputSchema =
  createGatewayA2aTargetInputSchemaDefinition;
export type CreateGatewayA2aTargetInput = z.input<typeof createGatewayA2aTargetInputSchema>;

const updateGatewayA2aTargetInputSchemaDefinition = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentName: z.string().min(1).max(128).optional(),
  cardUrl: httpUrlSchema.optional(),
  upstreamUrl: httpUrlSchema.optional(),
  /** Replaces the whole set when given. */
  upstreamHeaders: gatewayA2aTargetHeadersSchema.optional(),
  allowedVirtualKeyIds: z.array(z.string()).max(500).nullable().optional(),
  blocked: z.boolean().optional(),
  blockReason: z.string().max(512).nullable().optional(),
  actorUserId: z.string(),
});
export interface UpdateGatewayA2aTargetInputSchema extends Named<
  typeof updateGatewayA2aTargetInputSchemaDefinition
> {}
export const updateGatewayA2aTargetInputSchema: UpdateGatewayA2aTargetInputSchema =
  updateGatewayA2aTargetInputSchemaDefinition;
export type UpdateGatewayA2aTargetInput = z.input<typeof updateGatewayA2aTargetInputSchema>;

/** What the platform surface shows: header names only, never their values. */
const gatewayA2aTargetDtoSchemaDefinition = z.object({
  id: z.string(),
  organizationId: z.string(),
  projectId: z.string().nullable(),
  name: z.string(),
  agentName: z.string(),
  cardUrl: z.string(),
  upstreamUrl: z.string(),
  upstreamHeaderNames: z.array(z.string()),
  allowedVirtualKeyIds: z.array(z.string()).nullable(),
  blocked: z.boolean(),
  blockReason: z.string().nullable(),
  createdById: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export interface GatewayA2aTargetDtoSchema extends Named<
  typeof gatewayA2aTargetDtoSchemaDefinition
> {}
export const gatewayA2aTargetDtoSchema: GatewayA2aTargetDtoSchema =
  gatewayA2aTargetDtoSchemaDefinition;
export type GatewayA2aTargetDto = z.infer<typeof gatewayA2aTargetDtoSchema>;

/** One entry of the config bundle's `a2a_targets`, as services/aigateway decodes it. */
const gatewayA2aTargetWireSchemaDefinition = z.object({
  name: z.string(),
  agent_name: z.string(),
  card_url: z.string(),
  upstream_url: z.string(),
  upstream_headers: z.record(z.string(), z.string()),
  blocked: z.boolean(),
  block_reason: z.string(),
  allowed_virtual_key_ids: z.array(z.string()).nullable(),
});
export interface GatewayA2aTargetWireSchema extends Named<
  typeof gatewayA2aTargetWireSchemaDefinition
> {}
export const gatewayA2aTargetWireSchema: GatewayA2aTargetWireSchema =
  gatewayA2aTargetWireSchemaDefinition;
export type GatewayA2aTargetWire = z.infer<typeof gatewayA2aTargetWireSchema>;
