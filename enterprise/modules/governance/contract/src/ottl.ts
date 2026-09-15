import { z } from "zod";

export const ottlValidationErrorSchema = z
  .object({
    statementIndex: z.number().int().nonnegative(),
    line: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
    message: z.string(),
  })
  .strict();
export type OttlValidationError = z.infer<typeof ottlValidationErrorSchema>;

export const ottlValidationDeferredReasonSchema = z.enum([
  "gateway_unconfigured",
  "endpoint_unavailable",
]);
export type OttlValidationDeferredReason = z.infer<typeof ottlValidationDeferredReasonSchema>;

export const ottlValidationResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("valid") }).strict(),
  z
    .object({
      status: z.literal("invalid"),
      errors: z.array(ottlValidationErrorSchema),
    })
    .strict(),
  z
    .object({
      status: z.literal("deferred"),
      reason: ottlValidationDeferredReasonSchema,
    })
    .strict(),
]);
export type OttlValidationResult = z.infer<typeof ottlValidationResultSchema>;

export const ottlEncodingSchema = z.enum(["proto", "json"]);
export type OttlEncoding = z.infer<typeof ottlEncodingSchema>;

export const ottlTransformInputSchema = z
  .object({
    sourceId: z.string().min(1),
    kind: z.enum(["log", "metric"]),
    encoding: ottlEncodingSchema,
    payloadB64: z.string().min(1),
    statements: z.array(z.string()),
  })
  .strict();
export type OttlTransformInput = z.infer<typeof ottlTransformInputSchema>;

export const ottlTransformResultSchema = z.discriminatedUnion("ok", [
  z
    .object({
      ok: z.literal(true),
      payloadB64: z.string().min(1),
      encoding: ottlEncodingSchema,
    })
    .strict(),
  z
    .object({
      ok: z.literal(false),
      errors: z.array(ottlValidationErrorSchema),
    })
    .strict(),
]);
export type OttlTransformResult = z.infer<typeof ottlTransformResultSchema>;

export abstract class GovernanceOttlGateway {
  abstract validate(statements: string[]): Promise<OttlValidationResult>;
  abstract transform(input: OttlTransformInput): Promise<OttlTransformResult>;
}

export class OttlGatewayUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OttlGatewayUnavailableError";
  }
}
