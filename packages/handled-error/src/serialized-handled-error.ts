import { z } from "zod";

export const handledErrorFaultSchema = z.enum(["customer", "platform", "provider"]);
export type HandledErrorFault = z.output<typeof handledErrorFaultSchema>;

const jsonRecordSchema = z.record(z.string(), z.unknown());

export interface SerializedReason {
  code: string;
  /** @deprecated Compatibility alias of `code`; new consumers read `code`. */
  kind: string;
  retryable: boolean;
  fault?: HandledErrorFault;
  traceId?: string;
  spanId?: string;
  meta?: Record<string, unknown>;
  tips?: readonly string[];
  docsUrl?: string;
  reasons?: SerializedReason[];
}

export const serializedReasonSchema: z.ZodType<SerializedReason> = z.lazy(() =>
  z
    .object({
      code: z.string().optional(),
      kind: z.string().optional(),
      retryable: z.boolean().default(false),
      fault: handledErrorFaultSchema.optional(),
      traceId: z.string().optional(),
      spanId: z.string().optional(),
      meta: jsonRecordSchema.optional(),
      tips: z.array(z.string()).optional(),
      docsUrl: z.string().optional(),
      reasons: z.array(serializedReasonSchema).optional(),
    })
    .passthrough()
    .transform((value, context): SerializedReason | typeof z.NEVER => {
      const code = value.code ?? value.kind;
      if (code === void 0) {
        context.addIssue({
          code: "custom",
          message: "A serialized reason requires code or kind",
        });
        return z.NEVER;
      }

      return {
        ...value,
        code,
        kind: value.kind ?? code,
      };
    }),
);

export interface SerializedHandledError {
  code: string;
  /** @deprecated Compatibility alias of `code`; new consumers read `code`. */
  kind: string;
  retryable: boolean;
  meta: Record<string, unknown>;
  traceId: string | undefined;
  spanId: string | undefined;
  traceUrl?: string;
  httpStatus: number;
  fault: HandledErrorFault;
  tips?: readonly string[];
  docsUrl?: string;
  reasons: SerializedReason[];
}

const serializedHandledErrorWireSchema = z
  .object({
    code: z.string().optional(),
    kind: z.string().optional(),
    retryable: z.boolean().default(false),
    meta: jsonRecordSchema.default({}),
    traceId: z.string().optional(),
    spanId: z.string().optional(),
    traceUrl: z.string().optional(),
    httpStatus: z.number(),
    fault: handledErrorFaultSchema.default("customer"),
    tips: z.array(z.string()).optional(),
    docsUrl: z.string().optional(),
    reasons: z.array(serializedReasonSchema).default([]),
  })
  .passthrough()
  .transform((value, context): SerializedHandledError | typeof z.NEVER => {
    const code = value.code ?? value.kind;
    if (code === void 0) {
      context.addIssue({
        code: "custom",
        message: "A serialized handled error requires code or kind",
      });
      return z.NEVER;
    }

    return {
      ...value,
      code,
      kind: value.kind ?? code,
      traceId: value.traceId,
      spanId: value.spanId,
    };
  });

export const serializedHandledErrorSchema: z.ZodType<SerializedHandledError> =
  serializedHandledErrorWireSchema;
