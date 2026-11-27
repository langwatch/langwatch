import type { Named } from "@langwatch/module";
import { z } from "zod";

// The URL is public, so a malformed id (a NUL byte, say) is refused here as a
// 400 rather than reaching Postgres, which fails such a query with a 500.
const gatewayElevenLabsWebhookParamsSchemaDefinition = z.object({
  modelProviderId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
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
