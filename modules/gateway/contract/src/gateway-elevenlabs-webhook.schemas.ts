import { z } from "zod";

export const gatewayElevenLabsWebhookParamsSchema = z.object({
  modelProviderId: z.string(),
});

export const gatewayElevenLabsSignatureSchema = z.object({
  signature: z.string().optional(),
});

export const gatewayElevenLabsWebhookSuccessSchema = z.object({
  received: z.literal(true),
});

export const gatewayElevenLabsWebhookErrorSchema = z.object({
  error: z.string(),
});

export const gatewayElevenLabsWebhookAnswerSchema = z.union([
  gatewayElevenLabsWebhookSuccessSchema,
  gatewayElevenLabsWebhookErrorSchema,
]);
