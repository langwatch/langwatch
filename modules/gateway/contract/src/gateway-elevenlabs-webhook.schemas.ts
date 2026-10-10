import type { Named } from "@langwatch/module";
import { z } from "zod";

const gatewayElevenLabsWebhookParamsSchemaDefinition = z.object({
  modelProviderId: z.string(),
});
export interface GatewayElevenLabsWebhookParamsSchema extends Named<
  typeof gatewayElevenLabsWebhookParamsSchemaDefinition
> {}
export const gatewayElevenLabsWebhookParamsSchema: GatewayElevenLabsWebhookParamsSchema =
  gatewayElevenLabsWebhookParamsSchemaDefinition;

const gatewayElevenLabsSignatureSchemaDefinition = z.object({
  signature: z.string().optional(),
});
export interface GatewayElevenLabsSignatureSchema extends Named<
  typeof gatewayElevenLabsSignatureSchemaDefinition
> {}
export const gatewayElevenLabsSignatureSchema: GatewayElevenLabsSignatureSchema =
  gatewayElevenLabsSignatureSchemaDefinition;

const gatewayElevenLabsWebhookSuccessSchemaDefinition = z.object({
  received: z.literal(true),
});
export interface GatewayElevenLabsWebhookSuccessSchema extends Named<
  typeof gatewayElevenLabsWebhookSuccessSchemaDefinition
> {}
export const gatewayElevenLabsWebhookSuccessSchema: GatewayElevenLabsWebhookSuccessSchema =
  gatewayElevenLabsWebhookSuccessSchemaDefinition;

const gatewayElevenLabsWebhookErrorSchemaDefinition = z.object({
  error: z.string(),
});
export interface GatewayElevenLabsWebhookErrorSchema extends Named<
  typeof gatewayElevenLabsWebhookErrorSchemaDefinition
> {}
export const gatewayElevenLabsWebhookErrorSchema: GatewayElevenLabsWebhookErrorSchema =
  gatewayElevenLabsWebhookErrorSchemaDefinition;

const gatewayElevenLabsWebhookAnswerSchemaDefinition = z.union([
  gatewayElevenLabsWebhookSuccessSchema,
  gatewayElevenLabsWebhookErrorSchema,
]);
export interface GatewayElevenLabsWebhookAnswerSchema extends Named<
  typeof gatewayElevenLabsWebhookAnswerSchemaDefinition
> {}
export const gatewayElevenLabsWebhookAnswerSchema: GatewayElevenLabsWebhookAnswerSchema =
  gatewayElevenLabsWebhookAnswerSchemaDefinition;
